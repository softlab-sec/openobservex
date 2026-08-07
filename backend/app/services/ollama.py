"""Thin client for a local Ollama server.

All inference happens on this host. No telemetry leaves the deployment.

Inference is slow and blocking. To keep it from exhausting the default
Starlette thread pool (which also serves every dashboard query), AI work is
dispatched onto a small dedicated pool via run_in_ai_pool().
"""

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional, TypeVar

import time
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Dedicated pool for slow model calls, isolated from request-serving threads.
_ai_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai")

T = TypeVar("T")


async def run_in_ai_pool(fn: Callable[..., T], *args: Any) -> T:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_ai_pool, fn, *args)


class OllamaUnavailable(RuntimeError):
    """Raised when the model server cannot be reached or fails."""


def is_available() -> bool:
    try:
        r = httpx.get(f"{settings.ollama_url}/api/tags", timeout=3)
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


def installed_models() -> list[str]:
    try:
        r = httpx.get(f"{settings.ollama_url}/api/tags", timeout=5)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except Exception:  # noqa: BLE001
        return []


def generate(
    prompt: str,
    system: str,
    schema: Optional[dict[str, Any]] = None,
    temperature: float = 0.2,
) -> str:
    payload: dict[str, Any] = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {"temperature": temperature, "num_ctx": 4096},
    }
    if schema is not None:
        payload["format"] = schema

    try:
        r = httpx.post(
            f"{settings.ollama_url}/api/generate",
            json=payload,
            timeout=settings.ollama_timeout,
        )
        r.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("ollama request failed: %s", exc)
        raise OllamaUnavailable(str(exc)) from exc

    return r.json().get("response", "")


def generate_json(
    prompt: str, system: str, schema: dict[str, Any]
) -> dict[str, Any]:
    # One automatic retry: the local model is often warm/free on the second
    # attempt (cold-start or a concurrent call causes the first to fail).
    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            raw = generate(prompt, system, schema=schema)
            return json.loads(raw)
        except (OllamaUnavailable, json.JSONDecodeError) as exc:
            last_exc = exc
            logger.warning("ollama generate_json attempt %d failed: %s", attempt + 1, exc)
            if attempt == 0:
                time.sleep(1.5)
    raise OllamaUnavailable(f"model unavailable after retry: {last_exc}")
