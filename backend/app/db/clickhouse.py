"""ClickHouse access.

clickhouse-connect's Client is NOT thread-safe. FastAPI runs sync endpoints
in a thread pool, so concurrent dashboard requests would otherwise share one
client and corrupt each other's responses. We therefore keep one client per
thread, and retry once with a fresh client if a connection goes bad.
"""

import logging
import threading
import time
from typing import Any

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from app.config import settings

logger = logging.getLogger(__name__)

_local = threading.local()


def _connect() -> Client:
    return clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        username=settings.clickhouse_user,
        password=settings.clickhouse_password,
        database=settings.clickhouse_db,
        connect_timeout=5,
        send_receive_timeout=30,
    )


def get_clickhouse_client() -> Client:
    """Return this thread's client, creating it on first use."""
    client = getattr(_local, "client", None)
    if client is None:
        client = _connect()
        _local.client = client
    return client


def _reset() -> None:
    client = getattr(_local, "client", None)
    if client is not None:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass
    _local.client = None


def ch_query(query: str, parameters: dict[str, Any] | None = None, retries: int = 2):
    """Run a query, reconnecting once if the connection went bad."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            return get_clickhouse_client().query(query, parameters=parameters or {})
        except Exception as exc:  # noqa: BLE001
            last = exc
            logger.warning(
                "clickhouse query failed (attempt %d/%d): %s", attempt + 1, retries, exc
            )
            _reset()
            if attempt + 1 < retries:
                time.sleep(0.3)
    raise last  # type: ignore[misc]


def ch_query_scoped(
    query: str,
    parameters: dict[str, Any] | None = None,
    *,
    where_placeholder: str = "{tenant_scope}",
    app_namespace: str | None = None,
):
    """Run a telemetry query with mandatory tenant isolation injected.

    The query MUST contain the placeholder {tenant_scope}; it is replaced with
    a clause restricting rows to the caller's owned tenant tags. If the caller
    owns nothing, the clause is '1 = 0' (zero rows). This fails closed: a query
    without the placeholder raises, so isolation can never be silently skipped.
    """
    from app.core.tenant import get_tenant_context

    if where_placeholder not in query:
        raise ValueError(
            "ch_query_scoped requires the {tenant_scope} placeholder — "
            "refusing to run an unscoped telemetry query"
        )

    ctx = get_tenant_context()
    params = dict(parameters or {})

    if not ctx.owned_tags:
        clause = "1 = 0"
    else:
        names = []
        for i, tag in enumerate(ctx.owned_tags):
            key = f"_tenant{i}"
            params[key] = tag
            names.append(f"{{{key}:String}}")
        clause = f"ResourceAttributes['tenant.id'] IN ({','.join(names)})"
        if app_namespace:
            params["_app_ns"] = app_namespace
            clause += " AND ResourceAttributes['service.namespace'] = {_app_ns:String}"

    scoped = query.replace(where_placeholder, clause)
    return ch_query(scoped, params)
