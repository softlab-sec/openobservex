from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

import app.models  # noqa: F401  (ensures models register on Base.metadata)
from app.api.ai import router as ai_router
from app.api.alerts import router as alerts_router
from app.api.infra import router as infra_router
from app.api.applications import router as applications_router
from app.api.auth import router as auth_router
from app.api.telemetry import router as telemetry_router
from app.db.clickhouse import ch_query
from app.db.postgres import SessionLocal


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is owned by Alembic migrations (see backend/alembic).
    # Run them with: docker compose exec backend alembic upgrade head
    import asyncio

    from app.services.evaluator import evaluator_loop

    task = asyncio.create_task(evaluator_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    title="OpenObserveX API",
    version="0.2.0",
    description="Query API for the OpenObserveX observability platform.",
    lifespan=lifespan,
)

app.include_router(telemetry_router)
app.include_router(auth_router)
app.include_router(ai_router)
app.include_router(alerts_router)
app.include_router(infra_router)
app.include_router(applications_router)


@app.get("/", tags=["system"])
def root():
    return {"service": "OpenObserveX API", "docs": "/docs"}


@app.get("/health", tags=["system"])
def health():
    status = {"api": "ok", "clickhouse": "unknown", "postgres": "unknown"}
    try:
        ch_query("SELECT 1")
        status["clickhouse"] = "ok"
    except Exception as exc:  # noqa: BLE001
        status["clickhouse"] = f"error: {type(exc).__name__}"
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        status["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001
        status["postgres"] = f"error: {type(exc).__name__}"
    return status
