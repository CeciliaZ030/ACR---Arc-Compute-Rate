"""Every free web service in render.yaml must knock on its own front door.

A free Render instance sleeps after ~15 idle minutes, and a sleeping press posts
nothing: the poster runs on the service's own loop, so on-chain prints stop
until something wakes it. `ACR_SELF_URL` is the anti-sleep loop -- each tick
GETs `<self>/health`, which Render counts as traffic (measured on
`acr-probe-free`: `process_started_at` unchanged after 17.5 idle minutes).

`acr-api-mainnet` shipped with `ACR_SELF_URL: ""` ("once Render assigns it"),
and nobody came back for it. The loop was a no-op on the one service that
signs mainnet prints. Measured 2026-10-13/14: ACR-INF went 3.3 hours stale, and
all three indexes posted within minutes of an outside request waking the
press. The GitHub keepalive cron is no substitute: it fired every 3-5 hours.

Asserted against the file, because the file is what a deploy applies and a
test cannot read Render's env; `verify_live.py` checks the running service.
"""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _web_services() -> list[dict]:
    doc = yaml.safe_load((ROOT / "render.yaml").read_text(encoding="utf-8"))
    return [s for s in doc["services"] if s.get("type") == "web"]


def _env(service: dict) -> dict[str, str | None]:
    return {e["key"]: e.get("value") for e in (service.get("envVars") or [])}


def test_every_web_service_declares_a_real_self_url() -> None:
    blank = []
    for service in _web_services():
        url = (_env(service).get("ACR_SELF_URL") or "").strip()
        if not (url.startswith("https://") and url.rstrip("/").endswith(".onrender.com")):
            blank.append(f"{service['name']}: {url!r}")
    assert not blank, (
        "these services would sleep, because their self-ping is off: " + ", ".join(blank)
    )


def test_the_mainnet_press_pings_the_host_the_monitor_audits() -> None:
    """The keepalive job names the mainnet press's public host; the press must
    knock on that same host, or it keeps a different (or no) instance awake."""
    keepalive = yaml.safe_load(
        (ROOT / ".github/workflows/keepalive.yml").read_text(encoding="utf-8")
    )
    audited = None
    for job in keepalive["jobs"].values():
        for step in job.get("steps", []):
            audited = (step.get("env") or {}).get("ACR_API_URL") or audited
    assert audited, "keepalive.yml no longer names ACR_API_URL"

    mainnet = [s for s in _web_services() if s.get("name") == "acr-api-mainnet"]
    assert mainnet, "acr-api-mainnet is not in render.yaml"
    self_url = (_env(mainnet[0]).get("ACR_SELF_URL") or "").rstrip("/")
    assert self_url == audited.rstrip("/"), (
        f"acr-api-mainnet pings {self_url!r} but keepalive audits {audited!r}"
    )
