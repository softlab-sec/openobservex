#!/usr/bin/env bash
#
# Back up the OpenObserveX Postgres database (users, orgs, alert rules,
# incidents, API keys, applications, channels, maintenance windows).
#
# Produces a timestamped, gzipped SQL dump in infra/backups/.
# Reads credentials from the repo .env so it never hardcodes secrets.
#
# Usage:  ./infra/scripts/backup-postgres.sh
#
set -euo pipefail

# Resolve repo root (script lives in infra/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

# Load DB credentials from .env
if [[ ! -f .env ]]; then
  echo "ERROR: .env not found at $ROOT/.env" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${POSTGRES_USER:?POSTGRES_USER not set in .env}"
: "${POSTGRES_DB:?POSTGRES_DB not set in .env}"

BACKUP_DIR="$ROOT/infra/backups"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
OUT="$BACKUP_DIR/postgres-${POSTGRES_DB}-${STAMP}.sql.gz"

echo "Backing up Postgres database '${POSTGRES_DB}' ..."
# pg_dump inside the container, stream out, gzip on the host.
# --clean --if-exists makes the dump self-contained for restore.
docker compose exec -T postgres \
  pg_dump --username "$POSTGRES_USER" --clean --if-exists --no-owner "$POSTGRES_DB" \
  | gzip -c > "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "OK: wrote $OUT ($SIZE)"

# Retention: keep the 14 most recent backups, prune older ones.
KEEP=14
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/postgres-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if (( ${#OLD[@]} > 0 )); then
  echo "Pruning ${#OLD[@]} old backup(s), keeping newest $KEEP ..."
  rm -f "${OLD[@]}"
fi
