#!/usr/bin/env bash
#
# Restore the OpenObserveX Postgres database from a gzipped pg_dump.
#
# DESTRUCTIVE: the dump was taken with --clean --if-exists, so restoring
# drops and recreates existing objects. Requires an explicit confirmation.
#
# Usage:  ./infra/scripts/restore-postgres.sh <path-to-backup.sql.gz>
#         FORCE=1 ./infra/scripts/restore-postgres.sh <file>   # skip prompt
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <path-to-backup.sql.gz>" >&2
  echo "Available backups:" >&2
  ls -1t "$ROOT/infra/backups"/postgres-*.sql.gz 2>/dev/null | sed 's/^/  /' >&2 || true
  exit 1
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found at $ROOT/.env" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a
: "${POSTGRES_USER:?POSTGRES_USER not set in .env}"
: "${POSTGRES_DB:?POSTGRES_DB not set in .env}"

echo "About to RESTORE '${POSTGRES_DB}' from:"
echo "  $BACKUP_FILE"
echo "This OVERWRITES current data in the database."
if [[ "${FORCE:-0}" != "1" ]]; then
  read -r -p "Type 'restore' to proceed: " CONFIRM
  if [[ "$CONFIRM" != "restore" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

echo "Restoring ..."
# Decompress on the host, pipe into psql inside the container.
# ON_ERROR_STOP so a failed statement aborts loudly instead of a partial restore.
gunzip -c "$BACKUP_FILE" \
  | docker compose exec -T postgres \
      psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
           --set ON_ERROR_STOP=on --quiet

echo "OK: restore complete from $BACKUP_FILE"
