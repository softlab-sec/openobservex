"""Notification dispatch for alerts.

Supports Slack/Discord/generic webhooks. Slack and Discord both accept a
simple JSON body with a text/content field; generic webhooks receive the
full incident payload so downstream systems can parse it.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _classify(url: str) -> str:
    if "hooks.slack.com" in url:
        return "slack"
    if "discord.com/api/webhooks" in url or "discordapp.com/api/webhooks" in url:
        return "discord"
    return "generic"


def send_webhook(url: str, text: str, payload: dict[str, Any]) -> bool:
    """Post to one webhook. Returns True on 2xx."""
    kind = _classify(url)
    if kind == "slack":
        body: dict[str, Any] = {"text": text}
    elif kind == "discord":
        body = {"content": text}
    else:
        body = payload  # generic: full structured incident

    try:
        r = httpx.post(url, json=body, timeout=10)
        if r.status_code // 100 == 2:
            return True
        logger.warning("webhook %s returned %s: %s", kind, r.status_code, r.text[:200])
        return False
    except httpx.HTTPError as exc:
        logger.warning("webhook %s failed: %s", kind, exc)
        return False


def notify_all(urls: list[str], text: str, payload: dict[str, Any]) -> dict[str, bool]:
    """Fan out to every configured webhook. Returns per-url success."""
    results: dict[str, bool] = {}
    for url in urls:
        url = url.strip()
        if url:
            results[url] = send_webhook(url, text, payload)
    return results
