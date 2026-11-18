#!/usr/bin/env bash
# Spins up a throwaway local Postgres, applies the migrations and runs the RLS tests.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}
DIR=$(mktemp -d)
PORT=${PGPORT_TEST:-54329}
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown -R nobody "$DIR"; RUNAS=(runuser -u nobody --); fi
"${RUNAS[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/rls_tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  case "$f" in *storage*) continue;; esac   # storage schema only exists on real Supabase
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f supabase/rls_tests/rls_test.sql 2>&1 | sed "s/^psql:[^:]*:[0-9]*: NOTICE:  //" | grep -v "^$"
