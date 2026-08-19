#!/usr/bin/env bash
#
# Back up the OpenObserveX ClickHouse SCHEMA (table definitions only).
#
# Telemetry rows are re-ingestable (real apps keep sending; the simulator
# regenerates), so this deliberately backs up STRUCTURE, not data. The real
# risk is losing the table definitions — engine settings, partitioning,
# ORDER BY keys, the ResourceAttributes Map columns, and the materialized
# view — which are painful to reconstruct by hand. Restoring is just
# replaying the produced .sql against a fresh ClickHouse, then re-ingesting.
#
# For full DATA retention, see the native BACKUP path in infra/CLICKHOUSE-BACKUP.md.
#
# Usage:  ./infra/scripts/backup-clickhouse-schema.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found at $ROOT/.env" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a
: "${CLICKHOUSE_USER:?CLICKHOUSE_USER not set in .env}"
: "${CLICKHOUSE_PASSWORD:?CLICKHOUSE_PASSWORD not set in .env}"
: "${CLICKHOUSE_DB:?CLICKHOUSE_DB not set in .env}"

BACKUP_DIR="$ROOT/infra/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
OUT="$BACKUP_DIR/clickhouse-schema-${CLICKHOUSE_DB}-${STAMP}.sql"

chq() {
  docker compose exec -T clickhouse clickhouse-client \
    --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
    --database "$CLICKHOUSE_DB" --format TabSeparatedRaw --query "$1"
}

echo "Backing up ClickHouse schema for database '${CLICKHOUSE_DB}' ..."

{
  echo "-- OpenObserveX ClickHouse schema backup"
  echo "-- database: ${CLICKHOUSE_DB}"
  echo "-- taken:    ${STAMP}"
  echo "CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DB};"
  echo
} > "$OUT"

# Enumerate tables. Order matters: plain tables and views first, materialized
# views last (a MV depends on its source table existing). system.tables lists
# them; we sort so *_mv (materialized views) come after their sources.
mapfile -t TABLES < <(chq "SELECT name FROM system.tables WHERE database = '${CLICKHOUSE_DB}' ORDER BY (name LIKE '%_mv'), name")

for t in "${TABLES[@]}"; do
  [[ -z "$t" ]] && continue
  echo "-- ---------------------------------------------------------------------" >> "$OUT"
  echo "-- $t" >> "$OUT"
  echo "-- ---------------------------------------------------------------------" >> "$OUT"
  # SHOW CREATE returns the full DDL; make it replayable with IF NOT EXISTS.
  chq "SHOW CREATE TABLE ${CLICKHOUSE_DB}.\`${t}\`" \
    | sed 's/^CREATE TABLE /CREATE TABLE IF NOT EXISTS /; s/^CREATE MATERIALIZED VIEW /CREATE MATERIALIZED VIEW IF NOT EXISTS /' >> "$OUT"
  echo ";" >> "$OUT"
  echo >> "$OUT"
done

SIZE="$(du -h "$OUT" | cut -f1)"
echo "OK: wrote $OUT ($SIZE) — ${#TABLES[@]} tables"

# Retention: keep 14 most recent schema backups.
KEEP=14
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/clickhouse-schema-*.sql 2>/dev/null | tail -n +$((KEEP + 1)))
if (( ${#OLD[@]} > 0 )); then
  echo "Pruning ${#OLD[@]} old schema backup(s), keeping newest $KEEP ..."
  rm -f "${OLD[@]}"
fi
