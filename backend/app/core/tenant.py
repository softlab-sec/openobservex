"""Request-scoped tenant context + enforcement of query isolation.

The tenant dependency is ASYNC: it sets the ContextVar in the event-loop
context during dependency resolution. FastAPI then runs the sync telemetry
endpoint via anyio.to_thread.run_sync, which COPIES that context into the
worker thread — so ch_query_scoped reads the correct tags there. Concurrent
requests get independent copied contexts, so tenants cannot bleed into each
other. If the context is unset, the scoped query raises: isolation fails
closed, never open.
"""

import contextvars
from dataclasses import dataclass, field


@dataclass
class TenantContext:
    org_id: str
    owned_tags: list[str] = field(default_factory=list)


_ctx: contextvars.ContextVar["TenantContext | None"] = contextvars.ContextVar(
    "tenant_ctx", default=None
)


def set_tenant_context(ctx: "TenantContext") -> None:
    _ctx.set(ctx)


def get_tenant_context() -> "TenantContext":
    ctx = _ctx.get()
    if ctx is None:
        raise RuntimeError("tenant context not set — query attempted outside a scoped request")
    return ctx
