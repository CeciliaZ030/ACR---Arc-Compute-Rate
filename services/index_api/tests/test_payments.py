"""Real local contracts + HTTP API; no deployed addresses or external signer."""

import json
import shutil
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from index_api import operator, payments, statement
from web3 import Web3

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def chain():
    if not shutil.which("anvil"):
        pytest.skip("install Foundry and run forge build --root contracts")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        ["anvil", "--port", str(port), "--silent"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    w3 = Web3(Web3.HTTPProvider(f"http://127.0.0.1:{port}"))
    try:
        for _ in range(100):
            if w3.is_connected():
                break
            time.sleep(0.05)
        assert w3.is_connected()
        yield w3
    finally:
        process.terminate()
        process.wait(timeout=10)


@pytest.fixture
def setup(chain, tmp_path, monkeypatch):
    w3 = chain
    owner, vendor, stranger = w3.eth.accounts[:3]

    def deploy(name, args=()):
        artifact = json.loads((ROOT / f"contracts/out/{name}.sol/{name}.json").read_text())
        factory = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"]["object"])
        receipt = w3.eth.wait_for_transaction_receipt(
            factory.constructor(*args).transact({"from": owner})
        )
        return w3.eth.contract(address=receipt.contractAddress, abi=artifact["abi"])

    token = deploy("MockUSDC")
    wallet = deploy("PolicyWallet", [token.address])
    token.functions.mint(wallet.address, 1_000_000_000).transact({"from": owner})
    wallet.functions.setBudget(
        payments.category_id("inference"), 100_000_000, 10_000_000, 86400
    ).transact({"from": owner})
    log = tmp_path / "decisions.jsonl"
    row = {
        "at": time.time() - 86400,
        "business": "test-business",
        "obligation_id": "bill-1",
        "vendor": vendor,
        "category": "inference",
        "billed_usdc": 25.000001,
        "intent": "escalate",
        "escalated": True,
        "rule": "needs owner approval",
        "metered_quantity": 12,
        "vendor_quantity": 14,
        "par_usdc": None,
        "invoice_ref": "invoice-1",
    }
    log.write_text(json.dumps(row) + "\n")
    monkeypatch.setattr(operator, "LOG_PATH", str(log))
    monkeypatch.setattr(statement, "LOG_PATH", str(log))
    monkeypatch.setattr(statement, "ARCHIVE_PATH", tmp_path / "archive.jsonl")
    monkeypatch.setattr(statement, "SANDBOX_ARCHIVE_PATH", tmp_path / "sandbox.jsonl")
    cfg = tmp_path / "deployment.json"
    cfg.write_text(
        json.dumps(
            {
                "enabled": True,
                "business": "test-business",
                "chain_id": w3.eth.chain_id,
                "policy_wallet": wallet.address,
                "usdc": token.address,
                "api_url": "http://127.0.0.1",
            }
        )
    )
    monkeypatch.setenv("ACR_TREASURY_CONFIG", str(cfg))
    monkeypatch.setenv("ACR_TREASURY_API_TOKEN", "local-test-credential")
    monkeypatch.setenv("ACR_TREASURY_RPC_URL", w3.provider.endpoint_uri)
    monkeypatch.setenv("ACR_TREASURY_STATE_DIR", str(tmp_path / "payments"))
    app = FastAPI()
    app.include_router(payments.router)
    client = TestClient(app, headers={"authorization": "Bearer local-test-credential"})
    return {
        "w3": w3,
        "owner": owner,
        "vendor": vendor,
        "stranger": stranger,
        "wallet": wallet,
        "token": token,
        "log": log,
        "row": row,
        "client": client,
        "cfg": cfg,
        "state": tmp_path / "payments",
    }


def prepare(s, **overrides):
    body = {
        "obligation_id": "bill-1",
        "execution_account": s["owner"],
        "chain_id": s["w3"].eth.chain_id,
    }
    return s["client"].post("/operator/payments/prepare", json={**body, **overrides})


def send(s, prepared):
    tx = prepared["transaction"]
    # This is the local owner's explicit authorization boundary, not an API signer.
    return Web3.to_hex(
        s["w3"].eth.send_transaction(
            {"from": s["owner"], "to": tx["to"], "data": tx["data"], "value": 0}
        )
    )


def verify(s, tx):
    s["w3"].provider.make_request("anvil_mine", ["0x40"])
    return s["client"].post(
        "/operator/payments/verify", json={"obligation_id": "bill-1", "transaction_hash": tx}
    )


def test_owner_payment_and_idempotent_recovery(setup, monkeypatch):
    s = setup
    import acr_oracle_client.policy as policy

    monkeypatch.setattr(
        policy, "build_role_signer", lambda *a, **kw: pytest.fail("server signer used")
    )
    inbox = s["client"].get("/operator/payments").json()
    assert inbox["payments"][0]["evidence_age_seconds"] >= 86400
    assert inbox["payments"][0]["evidence"]["par_usdc"] is None
    preview = prepare(s)
    assert preview.status_code == 200, preview.text
    p = preview.json()
    assert p["amount_units"] == "25000001"
    assert p["remaining_after_units"] == "74999999"
    assert s["token"].functions.balanceOf(s["vendor"]).call() == 0
    assert prepare(s).json()["decision_hash"] == p["decision_hash"]  # cancellation/resume
    tx = send(s, p)
    # Lost callback: prepare refuses because the chain knows it already landed.
    assert prepare(s).status_code == 409
    assert verify(s, tx).json()["status"] == "paid"
    assert verify(s, tx).json()["status"] == "paid"
    assert len(s["log"].read_text().splitlines()) == 2
    assert s["client"].get("/operator/payments").json()["payments"] == []
    assert s["token"].functions.balanceOf(s["vendor"]).call() == 25_000_001


@pytest.mark.parametrize(
    "change",
    [
        "owner",
        "chain",
        "paused",
        "balance",
        "budget",
        "category",
        "code",
        "token",
        "precision",
        "nan",
        "resolved",
    ],
)
def test_preparation_refuses_unsafe_state(setup, change):
    s = setup
    override = {}
    if change == "owner":
        override["execution_account"] = s["stranger"]
    elif change == "chain":
        override["chain_id"] = 1
    elif change == "paused":
        s["wallet"].functions.setPaused(True).transact({"from": s["owner"]})
    elif change == "balance":
        s["wallet"].functions.withdraw(s["owner"], 1_000_000_000).transact({"from": s["owner"]})
    elif change == "budget":
        s["wallet"].functions.setBudget(payments.category_id("inference"), 10, 10, 86400).transact(
            {"from": s["owner"]}
        )
    elif change in ("category", "precision", "nan", "resolved"):
        s["row"].update(
            {"category": "missing"}
            if change == "category"
            else {"intent": "refuse"}
            if change == "resolved"
            else {"billed_usdc": "NaN" if change == "nan" else "0.0000001"}
        )
        s["log"].write_text(json.dumps(s["row"]) + "\n")
    else:
        config = json.loads(s["cfg"].read_text())
        config["policy_wallet" if change == "code" else "usdc"] = (
            s["stranger"] if change == "code" else s["wallet"].address
        )
        s["cfg"].write_text(json.dumps(config))
    assert prepare(s, **override).status_code in (403, 404, 409, 503)
    assert s["token"].functions.balanceOf(s["vendor"]).call() == 0


def test_auth_and_placeholder_configuration(setup, monkeypatch):
    s = setup
    assert (
        s["client"].get("/operator/payments", headers={"authorization": "Bearer wrong"}).status_code
        == 401
    )
    monkeypatch.setenv("ACR_OPS_TOKEN", "ops-token")
    assert (
        s["client"]
        .get("/operator/payments", headers={"authorization": "Bearer ops-token"})
        .status_code
        == 401
    )
    s["cfg"].write_text(json.dumps({"enabled": False, "chain_id": "<CHAIN_ID>"}))
    assert prepare(s).status_code == 503


@pytest.mark.parametrize(
    "field,value", [("business", "other"), ("amount", "1"), ("recipient", "0xabc")]
)
def test_payment_fields_cannot_be_overridden(setup, field, value):
    assert prepare(setup, **{field: value}).status_code == 422


def test_repeated_escalation_uses_original_decision(setup):
    s = setup
    original = prepare(s).json()
    with s["log"].open("a") as out:
        out.write(json.dumps({**s["row"], "at": time.time(), "rule": "review again"}) + "\n")
    assert prepare(s).json()["decision_hash"] == original["decision_hash"]
    with s["log"].open("a") as out:
        out.write(json.dumps({**s["row"], "at": time.time(), "billed_usdc": 30}) + "\n")
    assert prepare(s).status_code == 409


@pytest.mark.parametrize(
    "mismatch", ["recipient", "amount", "hash", "category", "actor", "contract", "revert"]
)
def test_unrelated_receipt_never_resolves_bill(setup, mismatch):
    s = setup
    p = prepare(s).json()
    cat = bytes.fromhex(p["category"][2:])
    digest = bytes.fromhex(p["decision_hash"][2:])
    recipient, amount = s["vendor"], int(p["amount_units"])
    if mismatch == "recipient":
        recipient = s["stranger"]
    if mismatch == "amount":
        amount -= 1
    if mismatch == "hash":
        digest = bytes.fromhex("ab" * 32)
    if mismatch == "category":
        cat = payments.category_id("other")
        s["wallet"].functions.setBudget(cat, 100_000_000, 10_000_000, 86400).transact(
            {"from": s["owner"]}
        )
    if mismatch == "actor":
        s["wallet"].functions.transferOwnership(s["stranger"]).transact({"from": s["owner"]})
        s["wallet"].functions.acceptOwnership().transact({"from": s["stranger"]})
    if mismatch == "contract":
        tx = s["token"].functions.transfer(s["vendor"], 0).transact({"from": s["owner"]})
    else:
        if mismatch == "revert":
            s["wallet"].functions.setPaused(True).transact({"from": s["owner"]})
        tx = (
            s["wallet"]
            .functions.spendAsOwner(cat, recipient, amount, digest)
            .transact({"from": s["stranger"] if mismatch == "actor" else s["owner"], "gas": 300000})
        )
    r = verify(s, Web3.to_hex(tx))
    assert r.status_code == 409, r.text
    assert len(s["log"].read_text().splitlines()) == 1


def test_pending_and_concurrent_reconciliation(setup):
    s = setup
    p = prepare(s).json()
    assert verify(s, "0x" + "ab" * 32).json()["status"] == "pending"
    tx = send(s, p)
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: verify(s, tx), range(4)))
    assert all(r.json()["status"] == "paid" for r in responses)
    assert len(s["log"].read_text().splitlines()) == 2


def test_ledger_failure_can_recover_without_repaying(setup, monkeypatch):
    s = setup
    tx = send(s, prepare(s).json())
    original = operator.LOG_PATH
    monkeypatch.setattr(operator, "LOG_PATH", str(s["state"]))  # directory cannot be appended
    r = verify(s, tx)
    assert r.status_code == 503, r.text
    monkeypatch.setattr(operator, "LOG_PATH", original)
    assert verify(s, tx).json()["status"] == "paid"
    assert s["token"].functions.balanceOf(s["vendor"]).call() == 25_000_001


def test_pending_finality_does_not_resolve_bill(setup):
    s = setup
    tx = send(s, prepare(s).json())
    response = s["client"].post(
        "/operator/payments/verify", json={"obligation_id": "bill-1", "transaction_hash": tx}
    )
    assert response.json()["status"] == "pending_finality"
    assert len(s["log"].read_text().splitlines()) == 1
    assert verify(s, tx).json()["status"] == "paid"


def test_legacy_server_payment_paths_are_disabled_for_inbox_business(setup):
    from index_api import ops_actions

    s = setup
    with pytest.raises(ops_actions.ActionError, match="owner-wallet inbox"):
        ops_actions.operator_approve(
            {"business": "test-business", "obligation_id": "bill-1"}, False
        )
    ob = operator.Obligation("bill-1", s["vendor"], 25.000001, business="test-business")
    decision = operator.run_obligation(ob, receipts=[], catalog={}, dry_run=False)
    assert decision.intent == "escalate"
    assert len(s["log"].read_text().splitlines()) == 1


def test_local_plugin_to_api_to_contract_roundtrip(setup):
    """Opt-in native plugin build: real FFI, HTTP, eth_call, transfer and receipt.

    This exercises the wallet handoff locally. It is not a browser/host signing
    test and cannot establish interactive authorization on a deployed host.
    """
    import ctypes
    import os
    import sys
    import threading

    import uvicorn

    if os.environ.get("ACR_TEST_PLUGIN") != "1":
        pytest.skip("set ACR_TEST_PLUGIN=1 to build and exercise the native Aomi plugin")
    s = setup
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    cfg = json.loads(s["cfg"].read_text())
    cfg["api_url"] = f"http://127.0.0.1:{port}"
    s["cfg"].write_text(json.dumps(cfg))
    app = FastAPI()
    app.include_router(payments.router)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.05)
        assert server.started
        manifest = str(ROOT / "integrations/aomi/Cargo.toml")
        for args in (
            ["cargo", "test", "--manifest-path", manifest, "treasury"],
            ["cargo", "build", "--manifest-path", manifest],
        ):
            result = subprocess.run(args, capture_output=True, text=True, timeout=180)
            assert result.returncode == 0, result.stdout + result.stderr
        extension = "dylib" if sys.platform == "darwin" else "so"
        lib = ctypes.CDLL(
            str(ROOT / f"integrations/aomi/target/debug/libacr_compute_rate.{extension}")
        )
        lib.aomi_create.restype = ctypes.c_void_p
        lib.aomi_manifest.argtypes = [ctypes.c_void_p]
        lib.aomi_manifest.restype = ctypes.c_void_p
        lib.aomi_async_tool_start.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,
            ctypes.c_char_p,
            ctypes.c_char_p,
        ]
        lib.aomi_async_tool_start.restype = ctypes.c_void_p
        lib.aomi_free_string.argtypes = [ctypes.c_void_p]
        lib.aomi_destroy.argtypes = [ctypes.c_void_p]
        instance = lib.aomi_create()

        def decode(ptr):
            try:
                return json.loads(ctypes.string_at(ptr))
            finally:
                lib.aomi_free_string(ptr)

        def call(name, args):
            ctx = {
                "session_id": "local-e2e",
                "call_id": "local-call",
                "tool_name": name,
                "state_attributes": {
                    "domain": {"evm": {"address": s["owner"], "chain_id": cfg["chain_id"]}}
                },
                "secrets": {"ACR_TREASURY_API_TOKEN": "local-test-credential"},
            }
            result = decode(
                lib.aomi_async_tool_start(
                    instance, name.encode(), json.dumps(args).encode(), json.dumps(ctx).encode()
                )
            )
            assert result["status"] == "ready", result
            assert "Ok" in result["result"], result
            return result["result"]["Ok"]

        try:
            loaded = decode(lib.aomi_manifest(instance))
            assert loaded["namespaces"] == ["evm-core"]
            assert (
                loaded["skills"][0]["guard"]["evm"]["contracts"]["TREASURY"] == s["wallet"].address
            )
            assert len(call("acr_pending_payments", {})["payments"]) == 1
            prepared = call("acr_prepare_payment", {"obligation_id": "bill-1"})
            stage = prepared["__aomi_tool_routes"][0]["args"]
            tx_args = {"from": s["owner"], "to": stage["to"], "data": stage["data"], "value": 0}
            s["w3"].eth.call(tx_args)  # Simulate before the local owner's submission.
            assert s["token"].functions.balanceOf(s["vendor"]).call() == 0
            tx = Web3.to_hex(s["w3"].eth.send_transaction(tx_args))
            s["w3"].provider.make_request("anvil_mine", ["0x40"])
            paid = call("acr_verify_payment", {"obligation_id": "bill-1", "transaction_hash": tx})
            assert paid["status"] == "paid"
            assert call("acr_pending_payments", {})["payments"] == []
            assert s["token"].functions.balanceOf(s["vendor"]).call() == 25_000_001
        finally:
            lib.aomi_destroy(instance)
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def test_snapshot_identity_uses_canonical_hash_not_python_numeric_equality(setup):
    s = setup
    s["row"]["at"] = 1000
    s["log"].write_text(json.dumps(s["row"]) + "\n")
    assert prepare(s).status_code == 200
    s["row"]["at"] = 1000.0  # Equal in Python, different canonical JSON bytes.
    s["log"].write_text(json.dumps(s["row"]) + "\n")
    assert prepare(s).status_code == 409


def test_configured_business_exports_require_treasury_credential(setup):
    from starlette.requests import Request

    s = setup
    bad = Request({"type": "http", "headers": []})
    with pytest.raises(payments.HTTPException) as exc:
        payments.require_business_credential(bad, "test-business")
    assert exc.value.status_code == 401
    good = Request(
        {"type": "http", "headers": [(b"authorization", b"Bearer local-test-credential")]}
    )
    payments.require_business_credential(good, "test-business")
    payments.require_business_credential(bad, "other-business")
    assert s["token"].functions.balanceOf(s["vendor"]).call() == 0
