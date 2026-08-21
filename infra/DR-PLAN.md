# OpenObserveX Disaster Recovery Plan

This is the runbook for recovering OpenObserveX after a failure. It is written
to be followed under pressure, in order, without prior context. It documents
what is protected, how quickly recovery is expected, the exact steps to recover,
and the known gaps that still carry risk.

Keep a copy of this document somewhere that survives the loss of the server it
describes. A recovery plan stored only on the machine that failed is not a plan.

## 1. Scope

Covered scenarios:
- Total loss of the host VM (hardware failure, provider outage, deletion).
- Data corruption or a bad migration that damages the application database.
- Accidental deletion of application data.

Not covered by this plan (tracked separately as future work):
- High availability / zero-downtime failover. The platform runs on a single
  node today; any host failure is a full outage until recovery completes.
- Off-site backup replication. Backups currently live on the same host (see
  Section 6, Known Gaps).

## 2. What we protect, by priority

Priority 1 - PostgreSQL (application state). This is the only irreplaceable
data: user accounts, roles, alert rules, incidents and their timelines,
notification channels, API key records, maintenance windows, and the append
only audit log. Loss here cannot be reconstructed from anything else.

Priority 2 - Configuration and code. The docker-compose file, service configs,
migrations, and environment template live in Git
(github.com/softlab-sec/openobservex). The one item NOT in Git is the .env file,
which holds secrets. It must be recreated or restored from a secure store during
recovery (see Section 4).

Priority 3 - ClickHouse (telemetry). Trace, log, and metric rows are
re-ingestable: real applications keep sending, and the store has a short TTL by
design. Only the schema (table definitions, engine settings, partitioning,
materialized views) is backed up, because that is what is painful to rebuild by
hand. Historical telemetry from before the failure is accepted as lost; this is
a deliberate trade-off, not an oversight.

## 3. Recovery objectives (current, honest numbers)

RPO (Recovery Point Objective) - how much data we can lose:
- PostgreSQL: up to 24 hours. Backups run nightly at 02:30 via cron. A failure
  just before the next run means losing up to a day of changes since the last
  backup.
- ClickHouse: telemetry since the failure is lost by design (re-ingestable).

RTO (Recovery Time Objective) - how long recovery takes:
- Estimated 2 to 4 hours for a total-VM-loss rebuild, assuming a replacement
  host and access to the latest backup and the .env secrets. The database
  restore itself is fast (the dataset is small; a proven restore completed in
  well under a minute in testing). Most of the RTO is provisioning the new host,
  installing Docker, and re-ingesting enough telemetry to be useful.
- For data corruption or accidental deletion (host intact), RTO is minutes: a
  single restore command against the running stack.

These numbers reflect the current single-node setup with local nightly backups.
The levers to improve them are listed in Section 6.

## 4. Recovery runbook

### Scenario A - Total VM loss (rebuild from scratch)

1. Provision a replacement host (same or larger: the load test validated a
   6-core / 7 GB VM). Install a current Linux, Docker Engine, and the Docker
   Compose plugin.

2. Clone the repository:
       git clone https://github.com/softlab-sec/openobservex.git
       cd openobservex

3. Restore the .env file. This holds POSTGRES_*, CLICKHOUSE_*, JWT_SECRET, and
   related secrets. Recreate it from your secure secret store or password
   manager. The database backup can only be restored with the SAME database
   credentials it was taken under, so these must match the originals.

4. Copy the latest backups onto the new host, into infra/backups/. You need the
   most recent postgres-openobservex-*.sql.gz and the most recent
   clickhouse-schema-openobservex-*.sql. (If backups were lost with the old
   host, see Section 6 - this is the current top risk.)

5. Start the datastores first so they are healthy before restoring:
       docker compose up -d postgres clickhouse
   Wait for both to report healthy:
       docker compose ps

6. Restore the PostgreSQL data:
       ./infra/scripts/restore-postgres.sh infra/backups/<latest-postgres-file>.sql.gz
   Type 'restore' at the prompt. The script drops and recreates objects from the
   dump, then loads the data.

7. Recreate the ClickHouse schema by replaying the schema dump against the
   fresh ClickHouse, then let ingestion refill it. Replay the statements from
   the latest clickhouse-schema-*.sql file into the ClickHouse container. See
   infra/CLICKHOUSE-BACKUP.md for the exact replay command and the native full
   data BACKUP path if point in time telemetry ever becomes a requirement.

8. Bring up the full stack:
       docker compose up -d
   This starts the API, worker, frontend, collector, gateway, and supporting
   services. Confirm migrations are current:
       docker compose exec backend alembic current
   It should report the latest revision. If not, run:
       docker compose exec backend alembic upgrade head

9. Verify recovery using the checklist in Section 5.

### Scenario B - Data corruption or bad migration (host intact)

1. Stop writes if possible (pause the affected workflow).
2. Identify the last known-good backup in infra/backups/ (they are timestamped;
   newest first with: ls -1t infra/backups/postgres-*.sql.gz).
3. Restore it:
       ./infra/scripts/restore-postgres.sh infra/backups/<good-backup>.sql.gz
4. Verify with Section 5. Accept the data loss between that backup and the
   failure (bounded by the RPO).

### Scenario C - Accidental deletion (host intact)

Same as Scenario B: restore the most recent backup taken before the deletion.
If the deletion is very recent and the nightly backup already captured the
deletion, the data is only recoverable if an earlier backup still predates it
(retention keeps the 14 most recent). This is a reason to keep RPO tight and
retention generous.

## 5. Recovery verification checklist

Recovery is complete only when all of these pass:
- The login page loads and an existing user can sign in.
- Alert rules are present and correct (Alerts page is populated).
- Incident history and the audit log show pre-failure records.
- New telemetry is arriving (the Overview / Services views show current data as
  ingestion resumes).
- The worker is evaluating: within one interval, the worker container logs
  evaluation activity, and firing rules produce incidents.
       docker compose logs worker --tail 20
- Migrations are at head:
       docker compose exec backend alembic current

## 6. Known gaps and risks

1. Backups are stored on the same host they protect. In a true total-VM-loss
   event, the backups in infra/backups/ are lost with the host, which would make
   Scenario A unrecoverable. This is the single highest-priority gap. The fix is
   to copy each nightly backup off the host (object storage such as S3 or B2, or
   a second machine) immediately after it is written. Until that exists, the DR
   plan is only fully effective for host-intact scenarios (B and C).

2. RPO is 24 hours. If a day of potential data loss is too much for production,
   increase backup frequency (for example hourly) by adding cron entries. The
   scripts already support this; only the schedule changes.

3. RTO includes manual steps. The rebuild is a runbook, not a one-command
   restore. If a faster RTO is required, the highest-value automation is a
   single bootstrap script that performs steps 5 through 8.

4. The .env secrets are a single point of failure for recovery. If they are lost
   and not stored anywhere off-host, the database backups cannot be restored
   (wrong credentials) and JWT sessions cannot be validated. Store .env in a
   secure secret manager, not only on the host.

## 7. Testing and maintenance

- Restore testing: perform a restore test at least quarterly, into a scratch
  database or a throwaway host, and confirm the verification checklist passes. A
  backup that has never been restored is an assumption, not a guarantee. One
  successful restore test has already been performed (the restore scripts were
  validated end to end when they were built).
- Review this plan whenever the architecture changes (new datastore, new
  critical service, changed backup location).
- After any real recovery, record what happened and update the runbook with
  anything that was missing or wrong.

## 8. Quick reference

- Backups directory: infra/backups/
- Postgres backup:   infra/scripts/backup-postgres.sh   (nightly 02:30 via cron)
- Postgres restore:  infra/scripts/restore-postgres.sh <file>
- ClickHouse schema: infra/scripts/backup-clickhouse-schema.sh
- Nightly automation: infra/scripts/backup-cron.sh  (logs to infra/backups/backup.log)
- ClickHouse full-data option: infra/CLICKHOUSE-BACKUP.md
- Retention: 14 most recent Postgres backups
- Repository: github.com/softlab-sec/openobservex
