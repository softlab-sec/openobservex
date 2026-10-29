"""Standalone tests for service-map focal/depth scoping (_scoped_subgraph).
Pure graph logic, no ClickHouse needed. Run:
  docker compose exec -T backend python3 tests_service_map_scope.py
"""
import sys
from app.api.telemetry import _scoped_subgraph


def N(*ids):
    return [{"id": i, "calls": 0, "error_pct": 0.0, "p95_ms": 0.0, "health": "healthy"} for i in ids]


def E(*pairs):
    return [{"source": s, "target": t, "calls": 1, "errors": 0, "avg_ms": 1, "p95_ms": 1, "error_pct": 0.0} for (s, t) in pairs]


# Synthetic graph with a cycle (pay -> chk) and a branch:
#   gw -> chk, gw -> usr
#   chk -> pay, chk -> inv
#   inv -> db, usr -> db
#   pay -> chk        (cycle)
NODES = N("gw", "chk", "pay", "inv", "db", "usr")
EDGES = E(("gw", "chk"), ("gw", "usr"), ("chk", "pay"), ("chk", "inv"),
          ("inv", "db"), ("usr", "db"), ("pay", "chk"))


def ids(res):
    return sorted(n["id"] for n in res["nodes"])


def eset(res):
    return sorted(e["source"] + ">" + e["target"] for e in res["edges"])


fails = 0


def check(name, got, want):
    global fails
    ok = got == want
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        print("   got :", got)
        print("   want:", want)
        fails += 1


ALL = ["chk", "db", "gw", "inv", "pay", "usr"]

# 1 direct (depth 1) on hub chk: callers {gw,pay} + callees {pay,inv}
r = _scoped_subgraph(NODES, EDGES, "chk", 1)
check("chk depth=1 nodes", ids(r), ["chk", "gw", "inv", "pay"])
check("chk depth=1 edges", eset(r), ["chk>inv", "chk>pay", "gw>chk", "pay>chk"])

# 2 two-hop widens by one ring -> all
check("chk depth=2 nodes", ids(_scoped_subgraph(NODES, EDGES, "chk", 2)), ALL)

# 3 all (depth 0) = full reachable closure
check("chk depth=0 nodes", ids(_scoped_subgraph(NODES, EDGES, "chk", 0)), ALL)

# 4 upstream direction: db's direct callers only
r = _scoped_subgraph(NODES, EDGES, "db", 1)
check("db depth=1 nodes (upstream)", ids(r), ["db", "inv", "usr"])
check("db depth=1 edges into db", eset(r), ["inv>db", "usr>db"])

# 5 downstream direction: gw's direct callees only
r = _scoped_subgraph(NODES, EDGES, "gw", 1)
check("gw depth=1 nodes (downstream)", ids(r), ["chk", "gw", "usr"])
check("gw depth=1 edges out of gw", eset(r), ["gw>chk", "gw>usr"])

# 6 unknown focus -> empty graph (no fabrication)
check("unknown focus nodes", ids(_scoped_subgraph(NODES, EDGES, "nope", 1)), [])
check("unknown focus edges", eset(_scoped_subgraph(NODES, EDGES, "nope", 1)), [])

# 7 invalid / out-of-band depth handled safely (treated as full closure)
check("negative depth -> closure", ids(_scoped_subgraph(NODES, EDGES, "chk", -5)), ALL)
check("huge depth -> closure", ids(_scoped_subgraph(NODES, EDGES, "chk", 999)), ALL)

# 8 cycle safety: closure from inside the cycle terminates and equals the closure
check("cycle closure terminates", ids(_scoped_subgraph(NODES, EDGES, "pay", 0)), ALL)

# 9 duplicate edges do not change membership (adjacency is a set)
DUP = EDGES + E(("gw", "chk"), ("gw", "chk"))
check("duplicate edges -> same nodes", ids(_scoped_subgraph(NODES, DUP, "gw", 1)), ["chk", "gw", "usr"])

if fails:
    print(f"\n{fails} FAILED")
    sys.exit(1)
print("\nALL PASS")
