"""SLO evaluation engine.

Computes the Service Level Indicator (SLI), error budget, and burn rate for an
SLO over its rolling window, using the same ClickHouse spans the alert evaluator
reads. The worker calls evaluate_slo() periodically and caches the result on the
SLO row; the API/UI read the cached values.

Definitions (standard SRE):
  SLI            = good_events / total_events  (as a percentage)
  target         = the objective, e.g. 99.9
  error budget   = the allowed bad fraction = (100 - target) percent of events
  budget_remaining_pct
                 = how much of that allowance is left, as a percentage:
                   100 * (1 - actual_bad / allowed_bad)
                   100 = untouched, 0 = exactly exhausted, <0 = target missed
  burn_rate      = (recent bad fraction) / (budget bad fraction)
                   1.0 = consuming budget exactly at the sustainable pace;
                   >1 = burning too fast, <1 = comfortably under.

"Good" depends on sli_type:
  availability   good = StatusCode != 'Error'
  latency        good = Duration <= latency_threshold_ms (Duration is ns in CH)

Honest simplifications (first version):
  - Event-based budget (fraction of requests), not time-based. This is the
    common request-SLO model and matches the span data we have.
  - Rolling window recomputed from raw spans each cycle (fine at current volume;
    a pre-aggregated rollup is the scale-up path).
  - Burn rate uses a short recent window (1h) vs the budget rate; multi-window
    burn-rate alerting (Google SRE workbook) is a later enhancement.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.db.clickhouse import ch_query
from app.db.postgres import SessionLocal

logger = logging.getLogger(__name__)

# recent window (hours) used to estimate the current burn rate
_BURN_WINDOW_HOURS = 1


def _good_predicate(sli_type: str, latency_threshold_ms: float | None) -> str:
    if sli_type == "latency":
        # Duration is stored in nanoseconds; threshold is in milliseconds.
        thr_ns = float(latency_threshold_ms or 0) * 1_000_000
        return f"Duration <= {thr_ns}"
    # availability: a request is good when it did not error
    return "StatusCode != 'Error'"


def _counts(good_pred: str, service: str | None, since_hours: float) -> tuple[int, int]:
    """Return (good, total) over the last `since_hours` hours, optional service."""
    svc_clause = ""
    params: dict = {"hrs": since_hours}
    if service:
        svc_clause = "AND ServiceName = {svc:String}"
        params["svc"] = service
    sql = f"""
        SELECT
            countIf({good_pred}) AS good,
            count() AS total
        FROM otel_traces
        WHERE Timestamp >= now() - INTERVAL {{hrs:Float64}} HOUR
          AND ParentSpanId = ''
          {svc_clause}
    """
    rows = ch_query(sql, params).result_rows
    if not rows:
        return 0, 0
    good, total = rows[0][0], rows[0][1]
    return int(good), int(total)


def evaluate_slo(slo) -> dict:
    """Compute current SLI, budget, and burn rate for one SLO.

    Returns a dict of the status fields; does not persist (caller stores it).
    """
    good_pred = _good_predicate(slo.sli_type, slo.latency_threshold_ms)
    window_hours = slo.window_days * 24

    good, total = _counts(good_pred, slo.service, window_hours)

    result: dict = {
        "total_events": total,
        "last_evaluated_at": datetime.now(timezone.utc),
    }

    if total == 0:
        # No traffic in the window: SLI is undefined. Report nulls rather than
        # a misleading 100% or 0%.
        result.update(
            current_sli=None, budget_remaining_pct=None, burn_rate=None, is_meeting=None
        )
        return result

    sli = good / total * 100.0
    target = slo.target

    # Error budget in fractional terms.
    allowed_bad_frac = (100.0 - target) / 100.0  # e.g. target 99.9 -> 0.001
    actual_bad_frac = (total - good) / total

    if allowed_bad_frac <= 0:
        # target = 100%: any failure exhausts the budget.
        budget_remaining_pct = 100.0 if actual_bad_frac == 0 else -100.0
    else:
        budget_remaining_pct = (1.0 - actual_bad_frac / allowed_bad_frac) * 100.0

    # Burn rate: recent bad fraction vs the sustainable (budget) bad fraction.
    burn_rate: float | None = None
    if allowed_bad_frac > 0:
        rgood, rtotal = _counts(good_pred, slo.service, _BURN_WINDOW_HOURS)
        if rtotal > 0:
            recent_bad_frac = (rtotal - rgood) / rtotal
            burn_rate = recent_bad_frac / allowed_bad_frac

    # Clamp displayed budget to [-100, 100]: below -100 just means "well past
    # exhausted", and a giant negative number is noise in the UI. burn_rate
    # remains the unbounded "how fast are we burning" signal.
    display_budget = max(-100.0, min(100.0, budget_remaining_pct))
    result.update(
        current_sli=round(sli, 4),
        budget_remaining_pct=round(display_budget, 2),
        burn_rate=round(burn_rate, 2) if burn_rate is not None else None,
        is_meeting=sli >= target,
    )
    return result


# how often the worker re-evaluates all SLOs. SLOs use long rolling windows and
# change slowly, so this is much less frequent than alert evaluation.
SLO_INTERVAL = 300  # 5 minutes


def evaluate_all_slos() -> int:
    """Evaluate every enabled SLO and cache its status. Returns the count."""
    from sqlalchemy import select
    from app.models import SLO

    db = SessionLocal()
    checked = 0
    try:
        slos = db.scalars(select(SLO).where(SLO.enabled.is_(True))).all()
        for slo in slos:
            try:
                status = evaluate_slo(slo)
                for k, v in status.items():
                    setattr(slo, k, v)
                checked += 1
            except Exception:  # noqa: BLE001
                logger.exception("failed to evaluate SLO %s", slo.name)
        db.commit()
    finally:
        db.close()
    return checked


async def slo_loop() -> None:
    import asyncio

    logger.info("SLO evaluator started (interval %ds)", SLO_INTERVAL)
    while True:
        try:
            n = await asyncio.to_thread(evaluate_all_slos)
            logger.debug("SLO evaluator checked %d SLOs", n)
        except Exception:  # noqa: BLE001
            logger.exception("SLO cycle failed")
        await asyncio.sleep(SLO_INTERVAL)
