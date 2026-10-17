"""A redeploy must ship the image it built, and say so only after reading it back.

On 2026-10-14 the testnet press was pinned in Render's dashboard to
`acr-api:2026-10-09-1755` while render.yaml said `:latest`. The deploy script
pushed `:latest`, Render re-pulled the pin, and the closing route-set check
passed because both images serve the same 50 routes: two deploys reported
success and shipped nothing. scripts/render_pin.py sets the service's imagePath
to the pushed tag and reads it back; these pin the decision and the wiring.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import render_pin  # noqa: E402

PUSHED = "docker.io/kaushtubh02/acr-api:2026-10-14-1339"
OLD_PIN = "docker.io/kaushtubh02/acr-api:2026-10-09-1755"


def test_the_image_is_found_wherever_the_api_nests_it() -> None:
    doc = {"id": "srv-x", "ownerId": "tea-1", "serviceDetails": {"image": {"imagePath": OLD_PIN}}}
    assert render_pin.image_of(doc) == (OLD_PIN, "tea-1")
    assert render_pin.image_of({"id": "srv-x"}) == (None, None)


def test_a_service_on_another_pin_is_not_running_the_push() -> None:
    assert render_pin.verdict(PUSHED, PUSHED) is None
    why = render_pin.verdict(OLD_PIN, PUSHED)
    assert why and OLD_PIN in why and "ship nothing new" in why
    assert "cannot be shown" in (render_pin.verdict(None, PUSHED) or "")


def test_the_deploy_pins_before_it_deploys_and_reads_back_after() -> None:
    script = (ROOT / "deploy" / "redeploy-render.sh").read_text()
    pin = script.index('render_pin.py" pin')
    trigger = script.index("/deploys")
    live = script.index("is live")
    check = script.index('render_pin.py" assert')
    drift = script.index("verify_deploy_drift.py")
    assert pin < trigger, "the service must point at the new image before the deploy pulls"
    assert live < check < drift, "what runs is read back after the deploy, before success is declared"


def test_render_yaml_never_declares_latest_for_a_pinned_service() -> None:
    text = (ROOT / "render.yaml").read_text()
    urls = re.findall(r"^\s*url:\s*(docker\.io/\S+)", text, flags=re.M)
    assert urls, "render.yaml lists no image urls"
    assert not [u for u in urls if u.endswith(":latest")], urls
