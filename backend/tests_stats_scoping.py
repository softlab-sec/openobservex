"""Stats service-scoping regression harness.

Run:
    docker compose exec -T backend python3 tests_stats_scoping.py

Proves the /stats scoping rule against real ClickHouse with injected fixtures:
global view counts entry (root) spans; a selected service counts its own spans
(including non-entry services with no root span); multiple spans for one service
in one trace count as operations without collapsing to the trace; errors scope
per service; unknown services return a genuine empty result; the time window
filters. Injects under a dedicated ScopeName and always cleans up.
"""
import sys
from app.db.clickhouse import ch_query
from app.api.telemetry import _trace_filters

SCOPE = "stats-scoping-fixture"


def _insert(rows):
    ch_query(
        "INSERT INTO otel_traces "
        "(Timestamp, TraceId, SpanId, ParentSpanId, SpanName, ServiceName, "
        "StatusCode, Duration, ResourceAttributes, ScopeName) VALUES " + ",".join(rows)
    )


def _row(trace, span, parent, name, svc, status, dur_ns, ts="now()"):
    return (
        f"({ts}, '{trace}', '{span}', '{parent}', '{name}', '{svc}', "
        f"'{status}', {dur_ns}, map('tenant.id','demo'), '{SCOPE}')"
    )


def cleanup():
    ch_query(f"ALTER TABLE otel_traces DELETE WHERE ScopeName='{SCOPE}'")


def _overview(service, errors_only=False, minutes=60):
    where, params = _trace_filters(minutes, service, errors_only)
    where = where.replace("{tenant_scope}", "ScopeName = {scope:String}")
    params["scope"] = SCOPE
    q = (
        "SELECT count() AS requests, countIf(StatusCode = 'Error') AS errors, "
        "uniqExact(TraceId) AS traces FROM otel_traces WHERE " + where
    )
    r = ch_query(q, params).result_rows
    return {"requests": r[0][0], "errors": r[0][1], "traces": r[0][2]} if r else {}


CHECKS = []


def check(name, got, want):
    ok = got == want
    CHECKS.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: got {got}, want {want}")


def main():
    cleanup()
    rows = [
        # Entry service: two recent root (entry) spans, one of them an error
        _row("ss0000000000000000000000000000001", "sss000000000a1", "", "GET /x", "ss-gateway", "Ok", 100000),
        _row("ss0000000000000000000000000000002", "sss000000000a2", "", "GET /x", "ss-gateway", "Error", 100000),
        # Downstream 'ss-db': child spans only; trace ...002 hits it twice
        _row("ss0000000000000000000000000000002", "sss000000000b1", "sss000000000a2", "query", "ss-db", "Ok", 100000),
        _row("ss0000000000000000000000000000002", "sss000000000b2", "sss000000000a2", "query", "ss-db", "Error", 100000),
        # Downstream 'ss-worker': one good child span
        _row("ss0000000000000000000000000000001", "sss000000000c1", "sss000000000a1", "work", "ss-worker", "Ok", 100000),
        # Old root span outside the 60m window
        _row("ss0000000000000000000000000000003", "sss000000000d1", "", "GET /x", "ss-gateway", "Ok", 100000, ts="now() - INTERVAL 1000 MINUTE"),
    ]
    _insert(rows)
    try:
        g = _overview(None)
        check("global counts root entry spans, time-windowed", (g["requests"], g["errors"], g["traces"]), (2, 1, 2))
        db = _overview("ss-db")
        check("non-entry service shows its own spans, not 0", db["requests"], 2)
        check("operations not collapsed to trace count", (db["requests"], db["traces"]), (2, 1))
        check("per-service error scoping", db["errors"], 1)
        w = _overview("ss-worker")
        check("ss-worker one good span, no errors", (w["requests"], w["errors"]), (1, 0))
        unk = _overview("does-not-exist")
        check("unknown service returns empty, no fallback", (unk["requests"], unk["errors"], unk["traces"]), (0, 0, 0))
        gw = _overview("ss-gateway")
        check("time window excludes old span", gw["requests"], 2)
        check("errors_only combines with service scope", _overview("ss-db", errors_only=True)["requests"], 1)
    finally:
        cleanup()
    passed, total = sum(CHECKS), len(CHECKS)
    print(f"\n{passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
