"""SLO evaluation semantics — regression harness.

Proves the canonical OpenObserveX SLI definitions against real ClickHouse,
using controlled injected fixtures (natural demo data can't exercise the
mixed-span case). Run:

    docker compose exec -T backend python3 tests_slo_semantics.py

Exits non-zero if any semantic regressed. Injects under a dedicated ScopeName
and always cleans up, even on failure.
"""
import sys
from app.db.clickhouse import ch_query
from app.services.slo import _counts, _good_predicate

SCOPE = "slo-regression-fixture"
GP = _good_predicate("availability", None)  # StatusCode != 'Error'
LAT = _good_predicate("latency", 500)        # Duration <= 500ms


def _insert(rows: list[str]) -> None:
    ch_query(
        "INSERT INTO otel_traces "
        "(Timestamp, TraceId, SpanId, ParentSpanId, SpanName, ServiceName, "
        "StatusCode, Duration, ResourceAttributes, ScopeName) VALUES " + ",".join(rows)
    )


def _row(trace, span, parent, name, svc, status, dur_ns):
    return (
        f"(now(), '{trace}', '{span}', '{parent}', '{name}', '{svc}', "
        f"'{status}', {dur_ns}, map('tenant.id','demo'), '{SCOPE}')"
    )


def cleanup():
    ch_query(f"ALTER TABLE otel_traces DELETE WHERE ScopeName='{SCOPE}'")


def main() -> int:
    cleanup()  # start clean
    # Fixtures:
    #  svc-clean:  2 traces, all-good root spans (entry point)
    #  svc-mixed:  1 trace with a good AND a bad span (the crux case)
    #  svc-downstream: 1 trace, child span only, good -> proves no-root-filter
    #  op 'work.do' on svc-downstream: 1 trace, child, bad -> endpoint operation
    #  api 'GET /x' on svc-clean: root span -> api request semantics
    rows = [
        # svc-clean: two good root requests
        _row("reg00000000000000000000000000001", "regs0000000000a1", "", "GET /x", "reg-svc-clean", "Ok", 100_000),
        _row("reg00000000000000000000000000002", "regs0000000000a2", "", "GET /x", "reg-svc-clean", "Ok", 100_000),
        # svc-mixed: one trace, good span + bad span (same service)
        _row("reg00000000000000000000000000003", "regs0000000000b1", "", "op.entry", "reg-svc-mixed", "Ok", 100_000),
        _row("reg00000000000000000000000000003", "regs0000000000b2", "regs0000000000b1", "op.inner", "reg-svc-mixed", "Error", 100_000),
        # svc-downstream: child-only spans (no root) — one good, one bad, different traces
        _row("reg00000000000000000000000000004", "regs0000000000c1", "regs00000000root", "work.do", "reg-svc-down", "Ok", 100_000),
        _row("reg00000000000000000000000000005", "regs0000000000c2", "regs00000000root", "work.do", "reg-svc-down", "Error", 100_000),
    ]
    _insert(rows)

    checks = []

    def check(label, got, expected):
        ok = got == expected
        checks.append(ok)
        print(f"[{'PASS' if ok else 'FAIL'}] {label}: got {got}, expected {expected}")

    # 1. service, all-good, root spans present -> 2 good / 2 total
    check("service clean (all good)", _counts(GP, "service", "reg-svc-clean", None, 1), (2, 2))
    # 2. THE CRUX: mixed trace counts as bad -> 0 good / 1 total
    check("service mixed span -> bad", _counts(GP, "service", "reg-svc-mixed", None, 1), (0, 1))
    # 3. service with only child spans is still measured (no root filter) -> 1 good / 2 total
    check("service downstream (child-only, no root filter)", _counts(GP, "service", "reg-svc-down", None, 1), (1, 2))
    # 4. endpoint operation on a child span is measurable -> good work.do trace only
    check("endpoint operation work.do", _counts(GP, "endpoint", "reg-svc-down", "work.do", 1), (1, 2))
    # 5. api route = root span request semantics -> 2 good / 2 total
    check("api route GET /x (root only)", _counts(GP, "api", "reg-svc-clean", "GET /x", 1), (2, 2))
    # 6. infrastructure fails closed (metric-native, not evaluable on traces)
    check("infrastructure fails closed", _counts(GP, "infrastructure", None, "any-host", 1), (0, 0))
    # 7. missing ref for endpoint fails closed
    check("endpoint missing ref fails closed", _counts(GP, "endpoint", "reg-svc-down", None, 1), (0, 0))

    cleanup()

    passed = sum(checks)
    total = len(checks)
    print(f"\n{passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    try:
        code = main()
    finally:
        cleanup()  # never leave fixtures behind
    sys.exit(code)
