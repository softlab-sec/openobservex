"""Standalone tests for the service registry: overlay merge + validation + the
unique (organization_id, name) constraint. DB-backed (uses the app's session);
ClickHouse discovery is monkeypatched so no telemetry is required. Rows are
created under an existing org and cleaned up afterwards.

Run: docker compose exec -T backend python3 tests_service_registry.py
"""
import sys
from fastapi import HTTPException
from sqlalchemy import select

import app.api.services as svc
from app.db.postgres import get_db
from app.models import Service, User

fails = 0


def check(name, cond):
    global fails
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails += 1


# ---- pure validation ----
def rejects(crit, metric):
    try:
        svc._validate(crit, metric)
        return False
    except HTTPException:
        return True


check("criticality tier1 accepted", not rejects("tier1", None))
check("criticality tier4 accepted", not rejects("tier4", None))
check("criticality junk rejected", rejects("gold", None))
check("sla_metric availability accepted", not rejects(None, "availability"))
check("sla_metric latency accepted", not rejects(None, "latency"))
check("sla_metric junk rejected", rejects(None, "uptime"))
check("none/none accepted", not rejects(None, None))


# ---- overlay merge against the real DB ----
gen = get_db()
db = next(gen)
NREG = "zz-registry-test-registered"   # curated AND discovered
NPRE = "zz-registry-test-prereg"        # curated, NOT discovered
NDIS = "zz-registry-test-discovered"    # discovered, NOT curated


def cleanup(org):
    for n in (NREG, NPRE, NDIS):
        row = db.scalar(select(Service).where(Service.organization_id == org, Service.name == n))
        if row:
            db.delete(row)
    db.commit()


try:
    user = db.scalars(select(User)).first()
    if user is None:
        print("SKIP overlay: no user in DB")
        sys.exit(1 if fails else 0)
    org = user.organization_id

    cleanup(org)

    db.add(Service(
        organization_id=org, name=NREG, owner="team-a", criticality="tier1",
        sla_target_pct=99.9, sla_window_days=30, sla_metric="availability",
    ))
    db.add(Service(organization_id=org, name=NPRE, owner="team-b", criticality="tier3"))
    db.commit()

    # unique (org, name): a second NREG insert must fail
    dup_rejected = False
    try:
        db.add(Service(organization_id=org, name=NREG, criticality="tier2"))
        db.commit()
    except Exception:
        db.rollback()
        dup_rejected = True
    check("unique (org,name) enforced", dup_rejected)

    # discovery: NREG + NDIS are live, NPRE is not
    svc._discovered_names = lambda: {NREG, NDIS}

    rows = svc.list_services(user=user, db=db)
    by = {r.name: r for r in rows}

    check("registered+discovered present",
          NREG in by and by[NREG].registered and by[NREG].discovered)
    check("registered row carries metadata",
          NREG in by and by[NREG].owner == "team-a" and by[NREG].criticality == "tier1"
          and by[NREG].sla_target_pct == 99.9 and by[NREG].sla_window_days == 30
          and by[NREG].sla_metric == "availability" and by[NREG].id is not None)
    check("pre-registered present, discovered=False",
          NPRE in by and by[NPRE].registered and not by[NPRE].discovered)
    check("discovered-only present, registered=False and no id/metadata",
          NDIS in by and by[NDIS].discovered and not by[NDIS].registered
          and by[NDIS].id is None and by[NDIS].owner is None)
    check("rows are name-sorted",
          [r.name for r in rows] == sorted(r.name for r in rows))

    cleanup(org)
finally:
    gen.close()

if fails:
    print(f"\n{fails} FAILED")
    sys.exit(1)
print("\nALL PASS")
