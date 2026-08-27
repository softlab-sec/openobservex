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
from datetime import datetime, timedelta, timezone

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


def _counts(
    good_pred: str,
    target_kind: str,
    service: str | None,
    target_ref: str | None,
    since_hours: float,
    start: datetime | None = None,
    end: datetime | None = None,
) -> tuple[int, int]:
    """Return (good, total) over the last `since_hours` hours, scoped to the
    SLO's actual target. Scope by target_kind:
      service        -> ServiceName = service
      api / endpoint -> ServiceName = service AND SpanName = target_ref (the route)
      infrastructure -> ResourceAttributes['service.instance.id'] = target_ref (host)
    A missing ref for api/endpoint/infra would silently widen scope, so we
    fail closed to zero rather than report a wrong (parent-scoped) SLI.
    """
    params: dict = {}
    clauses: list[str] = []

    # time bound: absolute [start, end) when both given, else rolling last-N-hours
    if start is not None and end is not None:
        time_clause = "Timestamp >= {start:DateTime64(9)} AND Timestamp < {end:DateTime64(9)}"
        params["start"] = start
        params["end"] = end
    else:
        time_clause = "Timestamp >= now() - INTERVAL {hrs:Float64} HOUR"
        params["hrs"] = since_hours

    # Measurement unit per target kind (canonical OpenObserveX SLI semantics):
    #   api      -> entry-point request: ROOT spans of the route, counted per span.
    #   service  -> the service's participation in a request: ALL spans of the
    #               service, counted per DISTINCT TRACE (a trace is bad if the
    #               service errored anywhere in it). No root filter.
    #   endpoint -> a single operation (root or child, may repeat in a trace):
    #               matching spans, per DISTINCT TRACE, same trace-bad rule.
    #   infrastructure -> metric-native; NOT evaluable on traces. Fail closed
    #               here until a metrics-based SLI path exists (see roadmap).
    if target_kind == "api":
        if not (service and target_ref):
            return 0, 0
        clauses.append("ServiceName = {svc:String}")
        clauses.append("SpanName = {ref:String}")
        params["svc"] = service
        params["ref"] = target_ref
        trace_level = False  # root request semantics
    elif target_kind == "endpoint":
        if not (service and target_ref):
            return 0, 0
        clauses.append("ServiceName = {svc:String}")
        clauses.append("SpanName = {ref:String}")
        params["svc"] = service
        params["ref"] = target_ref
        trace_level = True
    elif target_kind == "infrastructure":
        # infra targets are discovered from metrics (node_*), not traces; the
        # trace table cannot measure them. Fail closed rather than report a
        # misleading zero-as-if-evaluated. Metrics-based infra SLIs: roadmap.
        return 0, 0
    else:  # service (or default)
        if not service:
            return 0, 0
        clauses.append("ServiceName = {svc:String}")
        params["svc"] = service
        trace_level = True

    scope_clause = ("AND " + " AND ".join(clauses)) if clauses else ""
    if trace_level:
        # A trace is BAD if the scope has ANY erroring span in it; GOOD otherwise.
        # good = distinct traces - distinct traces containing a bad span.
        # No root filter: service/operation spans are downstream (child) spans.
        root_clause = ""
        total_expr = "uniq(TraceId)"
        bad_expr = f"uniqIf(TraceId, NOT ({good_pred}))"
        select_expr = f"{total_expr} - {bad_expr} AS good, {total_expr} AS total"
    else:
        # api: entry-point requests = root spans, counted per span.
        root_clause = "AND ParentSpanId = ''"
        select_expr = f"countIf({good_pred}) AS good, count() AS total"
    sql = f"""
        SELECT {select_expr}
        FROM otel_traces
        WHERE {time_clause}
          {root_clause}
          {scope_clause}
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

    # absolute range when both bounds are set, otherwise the rolling window
    abs_start = getattr(slo, "window_start", None)
    abs_end = getattr(slo, "window_end", None)
    is_absolute = abs_start is not None and abs_end is not None
    good, total = _counts(
        good_pred, slo.target_kind, slo.service, slo.target_ref,
        window_hours, start=abs_start, end=abs_end,
    )

    result: dict = {
        "total_events": total,
        "good_events": good,
        "bad_events": total - good,
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
    if allowed_bad_frac > 0 and not is_absolute:
        rgood, rtotal = _counts(good_pred, slo.target_kind, slo.service, slo.target_ref, _BURN_WINDOW_HOURS)
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


def budget_analytics(slo, db) -> dict:
    """Derive error-budget depth from the status history time series (Phase 4).

    Two on-read values, not stored (they are re-derivable from history):

      projected_exhaustion_at  When the remaining budget hits zero if the CURRENT
                               burn rate holds. Straight-line extrapolation from
                               the cached burn_rate/budget; None when not burning,
                               already exhausted, or no rate available. Advisory,
                               not a guarantee.

      breach_active / breach_since / breach_seconds
                               The most recent CONTIGUOUS run of not-meeting rows
                               ending at the latest sample. breach_since is that
                               run's earliest evaluated_at; breach_seconds is
                               now - breach_since. If the latest sample is meeting,
                               there is no active breach. "at_least" is True when
                               the run reaches the oldest history we have, so the
                               real start may be earlier than we can see.
    """
    from app.models.slo import SLOStatusHistory  # local import avoids cycle

    now = datetime.now(timezone.utc)
    out: dict = {
        "projected_exhaustion_at": None,
        "breach_active": False,
        "breach_since": None,
        "breach_seconds": None,
        "breach_at_least": False,
    }

    # --- projected exhaustion: from the SLO's current cached status ---
    budget = slo.budget_remaining_pct
    burn = slo.burn_rate
    # burn_rate is (recent bad frac / allowed bad frac): 1.0 burns the whole
    # budget over exactly one window. Days-to-zero = remaining_windows * window_days.
    if budget is not None and budget > 0 and burn is not None and burn > 0:
        remaining_frac = budget / 100.0            # e.g. 40% left -> 0.4
        windows_left = remaining_frac / burn       # burn=2 -> 0.2 windows left
        days_left = windows_left * slo.window_days
        out["projected_exhaustion_at"] = (now + timedelta(days=days_left)).isoformat()

    # --- active breach run: walk history newest-first ---
    rows = (
        db.query(SLOStatusHistory.evaluated_at, SLOStatusHistory.is_meeting)
        .filter(SLOStatusHistory.slo_id == slo.id)
        .order_by(SLOStatusHistory.evaluated_at.desc())
        .all()
    )
    if rows:
        latest_meeting = rows[0][1]
        if latest_meeting is False:  # currently breached
            breach_since = rows[0][0]
            reached_oldest = True
            for evaluated_at, is_meeting in rows:
                if is_meeting is False:
                    breach_since = evaluated_at
                else:
                    reached_oldest = False
                    break
            bs = breach_since if breach_since.tzinfo else breach_since.replace(tzinfo=timezone.utc)
            out["breach_active"] = True
            out["breach_since"] = bs.isoformat()
            out["breach_seconds"] = int((now - bs).total_seconds())
            out["breach_at_least"] = reached_oldest

    return out


# how often the worker re-evaluates all SLOs. SLOs use long rolling windows and
# change slowly, so this is much less frequent than alert evaluation.
SLO_INTERVAL = 300  # 5 minutes


# status keys that live on the SLO row itself (the cached snapshot). good/bad
# event counts are history-only and deliberately not stored on the SLO.
_SLO_STATUS_COLUMNS = (
    "current_sli", "budget_remaining_pct", "burn_rate",
    "total_events", "is_meeting", "last_evaluated_at",
)


def apply_status(slo, status: dict) -> None:
    """Copy the cached-status fields from an evaluation onto the SLO row."""
    for k in _SLO_STATUS_COLUMNS:
        if k in status:
            setattr(slo, k, status[k])


def evaluate_all_slos() -> int:
    """Evaluate every enabled SLO, cache its status, and append a history row.

    The cached status on the SLO answers "what is it now"; the history row is
    the time series that later powers breach duration, burn trend, projected
    exhaustion, and reporting.
    """
    from sqlalchemy import select
    from app.models import SLO, SLOStatusHistory

    db = SessionLocal()
    checked = 0
    try:
        slos = db.scalars(select(SLO).where(SLO.enabled.is_(True))).all()
        for slo in slos:
            try:
                status = evaluate_slo(slo)
                apply_status(slo, status)
                db.add(SLOStatusHistory(
                    slo_id=slo.id,
                    organization_id=slo.organization_id,
                    current_sli=status.get("current_sli"),
                    budget_remaining_pct=status.get("budget_remaining_pct"),
                    burn_rate=status.get("burn_rate"),
                    good_events=status.get("good_events"),
                    bad_events=status.get("bad_events"),
                    total_events=status.get("total_events"),
                    is_meeting=status.get("is_meeting"),
                ))
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
