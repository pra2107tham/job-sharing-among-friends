#!/usr/bin/env bash
# Local Postgres harness for migration + RLS development.
#
# This is NOT Supabase. It is a bare Postgres cluster plus a small stub of the
# `auth` schema (see supabase/tests/00_auth_stub.sql) so that RLS policies using
# auth.uid() can be executed and asserted exactly as Supabase would evaluate them.
# Use `supabase start` when Docker is available and you need the real thing
# (PostgREST, GoTrue, Storage, Realtime).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-$REPO_ROOT/.pgdata}"
PGPORT="${PGPORT:-54329}"
PGDATABASE="${PGDATABASE:-jobdrop}"
PGHOST=127.0.0.1
PGUSER=postgres
LOGFILE="$PGDATA/postgres.log"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "error: postgres binaries not found at $PGBIN (set PGBIN)" >&2
  exit 1
fi

# Postgres refuses to run as root. When we are root and a postgres system user
# exists, drop to it for anything that touches the data directory.
if [ "$(id -u)" -eq 0 ] && id postgres >/dev/null 2>&1; then
  as_pg() { su postgres -s /bin/bash -c "$*"; }
  fix_owner() { mkdir -p "$1" && chown -R postgres:postgres "$1"; }
else
  as_pg() { bash -c "$*"; }
  fix_owner() { mkdir -p "$1"; }
fi

psql_() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 "$@"; }

is_running() { "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" -q >/dev/null 2>&1; }

cmd_start() {
  if is_running; then
    echo "postgres already running on port $PGPORT"
  else
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      echo "==> initdb $PGDATA"
      fix_owner "$PGDATA"
      as_pg "$PGBIN/initdb -D '$PGDATA' -U $PGUSER --auth=trust --encoding=UTF8 --locale=C" \
        >/dev/null
    fi
    fix_owner "$PGDATA"
    echo "==> starting postgres on port $PGPORT"
    # Unix socket inside PGDATA so we never depend on /var/run/postgresql perms.
    # wal_level=logical matches Supabase, so the realtime publication in
    # 0011 applies without warnings.
    as_pg "$PGBIN/pg_ctl -D '$PGDATA' -l '$LOGFILE' -w -o \
      '-p $PGPORT -k $PGDATA -c listen_addresses=127.0.0.1 -c wal_level=logical' start" >/dev/null
  fi

  if ! psql_ -d postgres -tAc "select 1 from pg_database where datname='$PGDATABASE'" | grep -q 1; then
    echo "==> creating database $PGDATABASE"
    psql_ -d postgres -c "create database $PGDATABASE" >/dev/null
  fi
  echo "ready: postgresql://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
}

cmd_stop() {
  if is_running; then
    as_pg "$PGBIN/pg_ctl -D '$PGDATA' -m fast -w stop" >/dev/null
    echo "stopped"
  else
    echo "not running"
  fi
}

# Drop and rebuild the database from scratch: auth stub, then every migration in
# lexical order. Migrations are numbered, so lexical order is apply order.
cmd_reset() {
  cmd_start >/dev/null
  echo "==> resetting $PGDATABASE"
  psql_ -d postgres -c "drop database if exists $PGDATABASE with (force)" >/dev/null
  psql_ -d postgres -c "create database $PGDATABASE" >/dev/null

  # Fixtures = every .sql in tests/ that is not a *.test.sql, in name order.
  # These stand in for what Supabase provides (auth schema) plus test helpers.
  shopt -s nullglob
  for f in "$REPO_ROOT"/supabase/tests/*.sql; do
    case "$f" in
      *.test.sql) continue ;;
    esac
    echo "==> fixture $(basename "$f")"
    psql_ -d "$PGDATABASE" -q -f "$f" >/dev/null
  done

  for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
    echo "==> $(basename "$f")"
    psql_ -d "$PGDATABASE" -q -f "$f" >/dev/null
  done
  echo "schema ready"
}

cmd_test() {
  cmd_reset
  local failed=0
  shopt -s nullglob
  for f in "$REPO_ROOT"/supabase/tests/*.test.sql; do
    printf '\n===> %s\n' "$(basename "$f")"
    if psql_ -d "$PGDATABASE" -q -f "$f"; then
      echo "PASS $(basename "$f")"
    else
      echo "FAIL $(basename "$f")" >&2
      failed=1
    fi
  done
  if [ "$failed" -ne 0 ]; then
    echo; echo "RLS TEST SUITE FAILED" >&2
    exit 1
  fi
  echo; echo "all tests passed"
}

cmd_psql() { psql_ -d "$PGDATABASE" "$@"; }

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  reset) cmd_reset ;;
  test) cmd_test ;;
  psql) shift; cmd_psql "$@" ;;
  *)
    echo "usage: $0 {start|stop|reset|test|psql}" >&2
    exit 1
    ;;
esac
