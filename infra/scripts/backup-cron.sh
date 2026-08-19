#!/usr/bin/env bash
#
# Cron entrypoint for the nightly Postgres backup.
#
# Cron runs with a minimal environment (bare PATH, no login profile), which is
# the usual reason scheduled backups silently fail. This wrapper sets an
# explicit PATH, moves to the repo root, runs the backup, and appends a
# timestamped result to infra/backups/backup.log so a run can always be
# verified after the fact.
#
# Add to crontab (nightly at 02:30 server time):
#   30 2 * * * /home/observeops/openobservex/infra/scripts/backup-cron.sh
#
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ROOT="/home/observeops/openobservex"
LOG="$ROOT/infra/backups/backup.log"
cd "$ROOT" || { echo "$(date -u +%FT%TZ) ERROR cannot cd to $ROOT" >> "$LOG"; exit 1; }

echo "$(date -u +%FT%TZ) starting nightly backup" >> "$LOG"
if "$ROOT/infra/scripts/backup-postgres.sh" >> "$LOG" 2>&1; then
  echo "$(date -u +%FT%TZ) postgres backup OK" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) postgres backup FAILED (exit $?)" >> "$LOG"
fi
if "$ROOT/infra/scripts/backup-clickhouse-schema.sh" >> "$LOG" 2>&1; then
  echo "$(date -u +%FT%TZ) clickhouse schema backup OK" >> "$LOG"
else
  echo "$(date -u +%FT%TZ) clickhouse schema backup FAILED (exit $?)" >> "$LOG"
fi
