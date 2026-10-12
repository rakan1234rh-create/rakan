#!/usr/bin/env bash
# Disposable local-only check. It reads no Supabase URL/credentials and cannot reach production.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261012210000_auth_ingress_replay.sql"
PG_BIN="$(pg_config --bindir)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/athar-ingress-replay-pg.XXXXXX")"
DATA_DIR="$TMP_DIR/data"
SOCKET_DIR="$TMP_DIR/socket"
RESULT_DIR="$TMP_DIR/results"
PORT="$(python3 - <<'PY'
import socket
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"
STARTED=0

cleanup() {
  if [[ "$STARTED" == "1" ]]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() {
  [[ "$1" == "$2" ]] || fail "$3 (expected=$1 actual=$2)"
}

mkdir -p "$SOCKET_DIR" "$RESULT_DIR"
"$PG_BIN/initdb" --no-locale --encoding=UTF8 --auth=trust -D "$DATA_DIR" >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" -o "-F -k $SOCKET_DIR -p $PORT" -w start >/dev/null
STARTED=1
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -d postgres)

"${PSQL[@]}" >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

# Applying twice is intentional: migrations must remain safe in local recovery runs.
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

db_value() { "${PSQL[@]}" -qAtc "$1"; }
consume() {
  local key="$1"
  local expiration="$2"
  db_value "SET ROLE service_role; SELECT public.consume_auth_ingress_replay('$key', $expiration)::text;"
}

KEY_A="$(printf 'a%.0s' {1..64})"
assert_eq "f" "$(db_value "SELECT has_function_privilege('anon', 'public.consume_auth_ingress_replay(text,timestamptz)', 'EXECUTE');")" "anon must not execute replay RPC"
assert_eq "f" "$(db_value "SELECT has_function_privilege('authenticated', 'public.cleanup_auth_ingress_replays()', 'EXECUTE');")" "authenticated must not clean replay rows"
assert_eq "f" "$(db_value "SELECT has_table_privilege('anon', 'public.auth_ingress_replays', 'SELECT');")" "anon must not read replay table"
assert_eq "t" "$(db_value "SELECT has_function_privilege('service_role', 'public.consume_auth_ingress_replay(text,timestamptz)', 'EXECUTE');")" "service_role needs RPC"
if "${PSQL[@]}" -qAtc "SET ROLE anon; SELECT public.consume_auth_ingress_replay('$KEY_A', now() + interval '1 minute');" >/dev/null 2>&1; then
  fail "anon replay consume unexpectedly succeeded"
fi

assert_eq "true" "$(consume "$KEY_A" "now() + interval '90 seconds'")" "first valid nonce must be accepted"
assert_eq "false" "$(consume "$KEY_A" "now() + interval '90 seconds'")" "same nonce must be rejected"
assert_eq "1" "$(db_value "SELECT count(*) FROM public.auth_ingress_replays WHERE nonce_hash = '$KEY_A';")" "one replay row only"
assert_eq "false" "$(consume "$(printf 'b%.0s' {1..64})" "now() - interval '1 second'")" "expired nonce must reject"
assert_eq "false" "$(consume "$(printf 'c%.0s' {1..64})" "now() + interval '6 minutes'")" "unbounded future expiry must reject"

# Twenty concurrent consumers of one nonce: exactly one INSERT may win.
KEY_CONCURRENT="$(printf 'd%.0s' {1..64})"
SQL="SET ROLE service_role; SELECT public.consume_auth_ingress_replay('$KEY_CONCURRENT', now() + interval '90 seconds')::text;"
pids=()
for i in $(seq 1 20); do
  ("${PSQL[@]}" -qAtc "$SQL" >"$RESULT_DIR/$i") &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
assert_eq "1" "$(grep -lx true "$RESULT_DIR"/* | wc -l | tr -d ' ')" "only one concurrent consumer may win"
assert_eq "19" "$(grep -lx false "$RESULT_DIR"/* | wc -l | tr -d ' ')" "all replay attempts must lose"

# Bounded cleanup keeps TTL work out of consume and uses SKIP LOCKED in migration.
"${PSQL[@]}" -qAtc "INSERT INTO public.auth_ingress_replays (nonce_hash, consumed_at, expires_at) SELECT lpad(to_hex(10000 + n), 64, '0'), now() - interval '2 minutes', now() - interval '1 second' FROM generate_series(1, 525) AS n;" >/dev/null
assert_eq "500" "$(db_value "SET ROLE service_role; SELECT public.cleanup_auth_ingress_replays();")" "first cleanup must be bounded"
assert_eq "25" "$(db_value "SET ROLE service_role; SELECT public.cleanup_auth_ingress_replays();")" "second cleanup deletes remainder"

echo "PASS: replay migration ACL, expiry validation, atomic concurrency, bounded cleanup, idempotence"
