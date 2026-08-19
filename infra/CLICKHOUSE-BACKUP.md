# ClickHouse Backup

## What is backed up

`infra/scripts/backup-clickhouse-schema.sh` backs up the **schema** (all
table and materialized-view definitions) of the `openobservex` ClickHouse
database — engine settings, partitioning, ORDER BY keys, TTLs, the
`ResourceAttributes` Map columns, bloom-filter indexes, and the
`otel_traces_trace_id_ts_mv` materialized view.

It runs nightly via `infra/scripts/backup-cron.sh` alongside the Postgres
backup, writing a timestamped `.sql` into `infra/backups/` (14 kept).

## What is NOT backed up, and why

Telemetry **rows** are not backed up. They are re-ingestable: real
applications keep sending, and the demo simulator regenerates load. The
load test confirmed the pipeline re-absorbs data quickly. The real,
hard-to-recover risk is the **table structure**, which this covers.

Data also has a 3-day TTL (`TTL ... + toIntervalDay(3)`), so historical
rows expire by design regardless of backup.

## Restore the schema

Replay the most recent schema file into ClickHouse. Every statement uses
`IF NOT EXISTS`, so it is safe against a partially-populated database:

Then re-point applications (or the simulator) at the ingest gateway and
data flows back in. This restore path is tested: the schema replays cleanly
into a fresh database and recreates all tables including the materialized
view.

## Upgrade path: full data retention (native BACKUP)

If historical telemetry ever needs to survive (beyond the 3-day TTL and
beyond re-ingest), ClickHouse has a native, consistent `BACKUP` command.
It requires a backup disk declared in ClickHouse config, e.g. in
`config.d/backup_disk.xml`:

```xml
<clickhouse>
  <storage_configuration>
    <disks>
      <backups><type>local</type><path>/var/lib/clickhouse/backups/</path></backups>
    </disks>
  </storage_configuration>
  <backups><allowed_disk>backups</allowed_disk></backups>
</clickhouse>
```

Then:

This is deferred: telemetry is currently re-ingestable and TTL'd, so
schema backup is the right-sized protection for now.
