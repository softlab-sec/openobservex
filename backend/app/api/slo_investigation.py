"""Per-SLO breach investigation (Phase 8): what / where / why / when an
objective is failing, plus correlated incidents and anomalies. Read-only,
org-scoped by ownership.

Every telemetry query mirrors the scope the evaluator uses in
app/services/slo.py (_counts): the same ServiceName[/SpanName] filter and the
same window, so the contributing-factor evidence reconciles with the headline
SLI. History is bounded to the evaluation window and downsampled for the chart;
breach runs are computed from the full windowed series so they stay exact.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.db.postgres import get_db
from app.db.clickhouse import ch_query
from app.models import SLO, User, SLOStatusHistory
from app.models.alerting import Incident
from app.models.anomaly import Anomaly
from app.services.slo import evaluate_slo

router = APIRouter(prefix="/api/v1/slos", tags=["slos"])

_FACTOR_LIMIT = 8
_HISTORY_CAP = 800
_CORR_LIMIT = 20


def _iso(dt):
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def _window(slo):
    """(start, end, since_hours, label) mirroring evaluate_slo's window choice."""
    abs_start = getattr(slo, "window_start", None)
    abs_end = getattr(slo, "window_end", None)
    if abs_start is not None and abs_end is not None:
        return abs_start, abs_end, None, "custom range"
    return None, None, float(slo.window_days * 24), f"last {slo.window_days}d"


def _time_clause(start, end, since_hours, params) -> str:
    if start is not None and end is not None:
        params["start"] = start
        params["end"] = end
        return "Timestamp >= {start:DateTime64(9)} AND Timestamp < {end:DateTime64(9)}"
    params["hrs"] = since_hours
    return "Timestamp >= now() - INTERVAL {hrs:Float64} HOUR"


def _scope(slo, params):
    """Scope clauses mirroring _counts. Returns a list of SQL clauses, [] when a
    required ref is missing (fail closed), or None when the target is not
    trace-measurable (infrastructure)."""
    tk = slo.target_kind
    if tk == "infrastructure":
        return None
    if tk in ("api", "endpoint"):
        if not (slo.service and slo.target_ref):
            return []
        params["svc"] = slo.service
        params["ref"] = slo.target_ref
        return ["ServiceName = {svc:String}", "SpanName = {ref:String}"]
    if not slo.service:
        return []
    params["svc"] = slo.service
    return ["ServiceName = {svc:String}"]


def _scope_sql(scope) -> str:
    # [] (missing ref) fails closed to match the engine returning 0/0.
    if not scope:
        return "AND 1 = 0"
    return "AND " + " AND ".join(scope)


def _rows(result) -> list[dict]:
    cols = result.column_names
    return [dict(zip(cols, r)) for r in result.result_rows]


def _downsample(items, cap):
    n = len(items)
    if n <= cap:
        return items
    step = n / float(cap)
    idx = sorted({int(i * step) for i in range(cap)} | {n - 1})
    return [items[i] for i in idx]


def _infra_factors() -> dict:
    return {
        "kind": "infra_none",
        "columns": [],
        "rows": [],
        "note": "Infrastructure SLOs are metric-native and not measurable on traces yet.",
    }


def _factors_errors(slo, start, end, since_hours) -> dict:
    params: dict = {}
    scope = _scope(slo, params)
    if scope is None:
        return _infra_factors()
    tc = _time_clause(start, end, since_hours, params)
    sql = f"""
        SELECT SpanName AS operation,
               StatusMessage AS message,
               count() AS occurrences,
               round(quantile(0.95)(Duration) / 1e6, 1) AS p95_ms
        FROM otel_traces
        WHERE {tc}
          AND StatusCode = 'Error'
          {_scope_sql(scope)}
        GROUP BY operation, message
        ORDER BY occurrences DESC
        LIMIT {_FACTOR_LIMIT}
    """
    return {
        "kind": "errors",
        "columns": [
            {"key": "operation", "label": "Operation"},
            {"key": "message", "label": "Error"},
            {"key": "occurrences", "label": "Errors"},
            {"key": "p95_ms", "label": "p95 (ms)"},
        ],
        "rows": _rows(ch_query(sql, params)),
        "note": "Erroring operations in scope over the window, ranked by occurrence. This is where and why the budget is being spent.",
    }


def _factors_latency(slo, start, end, since_hours) -> dict:
    params: dict = {}
    scope = _scope(slo, params)
    if scope is None:
        return _infra_factors()
    tc = _time_clause(start, end, since_hours, params)
    params["thr"] = float(slo.latency_threshold_ms or 0) * 1_000_000
    sql = f"""
        SELECT SpanName AS operation,
               count() AS spans,
               round(quantile(0.95)(Duration) / 1e6, 1) AS p95_ms,
               round(quantile(0.99)(Duration) / 1e6, 1) AS p99_ms,
               round(100 * countIf(Duration > {{thr:Float64}}) / greatest(count(), 1), 2) AS over_pct
        FROM otel_traces
        WHERE {tc}
          {_scope_sql(scope)}
        GROUP BY operation
        ORDER BY p95_ms DESC
        LIMIT {_FACTOR_LIMIT}
    """
    thr = slo.latency_threshold_ms or 0
    return {
        "kind": "latency",
        "columns": [
            {"key": "operation", "label": "Operation"},
            {"key": "spans", "label": "Spans"},
            {"key": "p95_ms", "label": "p95 (ms)"},
            {"key": "p99_ms", "label": "p99 (ms)"},
            {"key": "over_pct", "label": "Over threshold %"},
        ],
        "rows": _rows(ch_query(sql, params)),
        "note": f"Slowest operations in scope against the {thr:g} ms threshold. Over threshold % is the share of spans past the bound.",
    }


def _factors_throughput(slo, start, end, since_hours) -> dict:
    params: dict = {}
    scope = _scope(slo, params)
    if scope is None:
        return _infra_factors()
    tc = _time_clause(start, end, since_hours, params)
    bkt = int(slo.bucket_seconds or 60)
    required = float(slo.rate_threshold_per_min or 0) * (bkt / 60.0)
    params["bkt"] = bkt
    sql = f"""
        SELECT toStartOfInterval(Timestamp, INTERVAL {{bkt:UInt32}} SECOND) AS bucket,
               count() AS requests
        FROM otel_traces
        WHERE {tc}
          AND ParentSpanId = ''
          {_scope_sql(scope)}
        GROUP BY bucket
        ORDER BY requests ASC
        LIMIT {_FACTOR_LIMIT}
    """
    rows = _rows(ch_query(sql, params))
    for r in rows:
        b = r.get("bucket")
        if hasattr(b, "isoformat"):
            r["bucket"] = (b if b.tzinfo else b.replace(tzinfo=timezone.utc)).isoformat()
        r["required"] = round(required, 2)
    mins = bkt // 60 if bkt >= 60 else 0
    label = f"{mins}-min" if mins else f"{bkt}-second"
    return {
        "kind": "throughput",
        "columns": [
            {"key": "bucket", "label": "Bucket"},
            {"key": "requests", "label": "Requests"},
            {"key": "required", "label": "Floor"},
        ],
        "rows": rows,
        "note": f"Lowest-traffic {label} buckets. A bucket below the floor of {required:g} requests spends budget.",
    }


def _breaches(hrows) -> list[dict]:
    """Contiguous runs of not-meeting history rows. A run that reaches the final
    sample is still ongoing."""
    out: list[dict] = []
    run_start = None
    last_t = None
    for ev, _sli, _bud, _burn, meeting in hrows:
        t = ev if ev.tzinfo else ev.replace(tzinfo=timezone.utc)
        if meeting is False:
            if run_start is None:
                run_start = t
        else:
            if run_start is not None:
                out.append({
                    "start": run_start.isoformat(),
                    "end": last_t.isoformat(),
                    "duration_seconds": int((last_t - run_start).total_seconds()),
                    "ongoing": False,
                })
                run_start = None
        last_t = t
    if run_start is not None and last_t is not None:
        out.append({
            "start": run_start.isoformat(),
            "end": last_t.isoformat(),
            "duration_seconds": int((last_t - run_start).total_seconds()),
            "ongoing": True,
        })
    return out


def _correlations(slo, db, w_lo, w_hi) -> dict:
    """Incidents and anomalies for the SLO's service that overlap the evaluation
    window. Service-scoped and time-overlapping, so the list stays relevant."""
    out = {"incidents": [], "anomalies": []}
    if not slo.service:
        return out

    inc = (
        db.query(Incident)
        .filter(
            Incident.organization_id == slo.organization_id,
            Incident.service == slo.service,
            Incident.started_at <= w_hi,
            or_(Incident.resolved_at.is_(None), Incident.resolved_at >= w_lo),
        )
        .order_by(Incident.started_at.desc())
        .limit(_CORR_LIMIT)
        .all()
    )
    out["incidents"] = [
        {
            "id": str(i.id),
            "kind": i.kind,
            "severity": i.severity,
            "status": i.status,
            "summary": i.summary,
            "started_at": _iso(i.started_at),
            "resolved_at": _iso(i.resolved_at),
        }
        for i in inc
    ]

    anom = (
        db.query(Anomaly)
        .filter(
            Anomaly.organization_id == slo.organization_id,
            Anomaly.service == slo.service,
            Anomaly.first_seen <= w_hi,
            or_(Anomaly.resolved_at.is_(None), Anomaly.last_seen >= w_lo),
        )
        .order_by(Anomaly.first_seen.desc())
        .limit(_CORR_LIMIT)
        .all()
    )
    out["anomalies"] = [
        {
            "id": str(a.id),
            "metric": a.metric,
            "severity": a.severity,
            "status": a.status,
            "z_score": round(a.z_score, 2),
            "first_seen": _iso(a.first_seen),
            "last_seen": _iso(a.last_seen),
            "promoted_incident_id": str(a.promoted_incident_id) if a.promoted_incident_id else None,
        }
        for a in anom
    ]
    return out


@router.get("/{slo_id}/investigation")
def slo_investigation(
    slo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """What/where/why/when one SLO is failing: live header, SLI history, breach
    runs, metric-aware contributing factors scoped exactly as the SLI is, and
    correlated incidents/anomalies for the service over the window."""
    slo = db.scalar(
        select(SLO).where(SLO.id == slo_id, SLO.organization_id == user.organization_id)
    )
    if slo is None:
        raise HTTPException(status_code=404, detail="SLO not found")

    start, end, since_hours, window_label = _window(slo)
    now = datetime.now(timezone.utc)
    if start is not None and end is not None:
        w_lo, w_hi = start, end
    else:
        w_lo, w_hi = now - timedelta(days=slo.window_days), now

    # header computed live so it reconciles with the factor queries' window
    status = evaluate_slo(slo)

    # projected exhaustion from live budget/burn: straight-line, advisory
    projected = None
    budget = status.get("budget_remaining_pct")
    burn = status.get("burn_rate")
    if budget is not None and budget > 0 and burn is not None and burn > 0:
        windows_left = (budget / 100.0) / burn
        projected = (now + timedelta(days=windows_left * slo.window_days)).isoformat()

    # history bounded to the window; breaches from the full windowed series,
    # chart series downsampled so the payload stays small at long windows.
    hrows = (
        db.query(
            SLOStatusHistory.evaluated_at,
            SLOStatusHistory.current_sli,
            SLOStatusHistory.budget_remaining_pct,
            SLOStatusHistory.burn_rate,
            SLOStatusHistory.is_meeting,
        )
        .filter(SLOStatusHistory.slo_id == slo.id, SLOStatusHistory.evaluated_at >= w_lo)
        .order_by(SLOStatusHistory.evaluated_at.asc())
        .all()
    )
    history_full = []
    for ev, sli, bud, brn, meeting in hrows:
        t = ev if ev.tzinfo else ev.replace(tzinfo=timezone.utc)
        history_full.append({
            "t": t.isoformat(),
            "sli": sli,
            "budget": bud,
            "burn": brn,
            "meeting": meeting,
        })
    history = _downsample(history_full, _HISTORY_CAP)
    breaches = _breaches(hrows)

    st = slo.sli_type
    if st == "throughput":
        factors = _factors_throughput(slo, start, end, since_hours)
    elif st in ("latency", "latency_percentile"):
        factors = _factors_latency(slo, start, end, since_hours)
    else:  # availability, error_rate
        factors = _factors_errors(slo, start, end, since_hours)

    correlations = _correlations(slo, db, w_lo, w_hi)

    return {
        "slo": {
            "id": str(slo.id),
            "name": slo.name,
            "sli_type": slo.sli_type,
            "target_kind": slo.target_kind,
            "service": slo.service,
            "target_ref": slo.target_ref,
            "target": slo.target,
            "window_days": slo.window_days,
            "window_label": window_label,
            "latency_threshold_ms": slo.latency_threshold_ms,
            "rate_threshold_per_min": slo.rate_threshold_per_min,
            "latency_percentile": slo.latency_percentile,
            "bucket_seconds": slo.bucket_seconds,
        },
        "status": {
            "current_sli": status.get("current_sli"),
            "budget_remaining_pct": status.get("budget_remaining_pct"),
            "burn_rate": status.get("burn_rate"),
            "is_meeting": status.get("is_meeting"),
            "total_events": status.get("total_events"),
            "good_events": status.get("good_events"),
            "bad_events": status.get("bad_events"),
            "projected_exhaustion_at": projected,
        },
        "history": history,
        "breaches": breaches,
        "factors": factors,
        "correlations": correlations,
    }
