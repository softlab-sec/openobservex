"""Route a notification to a channel by its kind.

One entry point the alert evaluator and the "test" button both use, so live
alerts and test sends go through identical logic. Payloads are built here so
this module only depends on send_webhook, not on notifications internals.
"""

import json
from typing import Any

from app.services.email import send_email
from app.services.notifications import send_webhook


def dispatch(channel_kind: str, config: dict[str, Any], subject: str, body: str) -> tuple[bool, str]:
    """Send `body` to one channel. Returns (ok, detail). Never raises."""
    try:
        if channel_kind == "email":
            return send_email(config, subject, body)
        if channel_kind == "slack":
            url = config.get("webhook_url", "")
            return (send_webhook(url, body, {"text": body}), "slack")
        if channel_kind == "discord":
            url = config.get("webhook_url", "")
            return (send_webhook(url, body, {"content": body}), "discord")
        if channel_kind == "webhook":
            url = config.get("url", "")
            return (send_webhook(url, body, {"text": body}), "webhook")
        return False, f"unknown channel kind: {channel_kind}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def parse_config(raw: str) -> dict:
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {}
