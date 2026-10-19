#!/bin/sh
set -eu

case "${RUN_MIGRATIONS_ON_START:-true}" in
  true)
    : "${DATABASE_URL:?DATABASE_URL is required}"
    echo '[startup] Applying pending database migrations before starting the API'
    DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}" node dist/shared/config/migrate.js &
    migration_pid=$!
    trap 'kill -TERM "$migration_pid" 2>/dev/null || true; wait "$migration_pid" 2>/dev/null || true; exit 143' TERM
    trap 'kill -INT "$migration_pid" 2>/dev/null || true; wait "$migration_pid" 2>/dev/null || true; exit 130' INT
    if wait "$migration_pid"; then
      echo '[startup] Database migrations complete'
    else
      code=$?
      echo '[startup] Database migration failed; API will not start' >&2
      exit "$code"
    fi
    trap - TERM INT
    ;;
  false)
    echo '[startup] Automatic migrations disabled; schema must already be deployed'
    ;;
  *)
    echo '[startup] RUN_MIGRATIONS_ON_START must be true or false' >&2
    exit 1
    ;;
esac

# The long-running API uses DATABASE_URL, not the migration credential.
unset MIGRATION_DATABASE_URL
exec node dist/index.js
