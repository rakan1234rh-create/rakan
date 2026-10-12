#!/usr/bin/env bash
# اختبار محلي معزول فقط؛ لا يقرأ SUPABASE_URL ولا يتصل بأي قاعدة بعيدة.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION="$REPO_ROOT/supabase/migrations/20261012201000_security_recovery.sql"
PG_BIN="$(pg_config --bindir)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/athar-recovery-pg.XXXXXX")"
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

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  [[ "$actual" == "$expected" ]] || fail "$message (expected=$expected actual=$actual)"
}

mkdir -p "$SOCKET_DIR" "$RESULT_DIR"
"$PG_BIN/initdb" --no-locale --encoding=UTF8 --auth=trust -D "$DATA_DIR" >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA_DIR" -o "-F -k $SOCKET_DIR -p $PORT" -w start >/dev/null
STARTED=1
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -d postgres)

# نهيئ فقط الأشياء القديمة التي تتوقع migration وجودها في المشروع الفعلي.
"${PSQL[@]}" >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.password_reset_attempts (email text);
CREATE FUNCTION public.record_password_reset_attempt(text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION public.check_password_reset_rate_limit(text)
RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.clear_password_reset_attempts(text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
SQL

# إعادة تطبيق نفس الملف مرتين جزء مقصود من اختبار idempotence.
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

db_value() {
  "${PSQL[@]}" -qAtc "$1"
}

consume() {
  local email_key="$1"
  local ip_key="$2"
  db_value "SET ROLE service_role; SELECT (allowed::int)::text || ':' || retry_after_seconds::text FROM public.consume_password_recovery_rate_limit('$email_key', '$ip_key');"
}

# ACL: لا يملك العميل أي تنفيذ/قراءة، بينما service_role يملك RPC فقط.
assert_eq "f" "$(db_value "SELECT has_function_privilege('anon', 'public.consume_password_recovery_rate_limit(text,text)', 'EXECUTE');")" "anon must not execute consume RPC"
assert_eq "f" "$(db_value "SELECT has_function_privilege('authenticated', 'public.cleanup_password_recovery_rate_limits()', 'EXECUTE');")" "authenticated must not execute cleanup RPC"
assert_eq "f" "$(db_value "SELECT has_table_privilege('anon', 'public.password_recovery_rate_limits', 'SELECT');")" "anon must not read counters"
assert_eq "t" "$(db_value "SELECT has_function_privilege('service_role', 'public.consume_password_recovery_rate_limit(text,text)', 'EXECUTE');")" "service_role must execute consume RPC"
if "${PSQL[@]}" -qAtc "SET ROLE anon; SELECT * FROM public.consume_password_recovery_rate_limit(repeat('a', 64), repeat('b', 64));" >/dev/null 2>&1; then
  fail "anon call unexpectedly succeeded"
fi
if "${PSQL[@]}" -qAtc "SET ROLE service_role; SELECT * FROM public.consume_password_recovery_rate_limit(NULL, repeat('b', 64));" >/dev/null 2>&1; then
  fail "NULL limiter key unexpectedly succeeded"
fi

# ثلاثة طلبات بريد تقبل والرابع يرفض، ولا يزيد العداد عند الرفض.
EMAIL_3="$(printf 'a%.0s' {1..64})"
IP_3="$(printf 'b%.0s' {1..64})"
for _ in 1 2 3; do
  assert_eq "1:0" "$(consume "$EMAIL_3" "$IP_3")" "first three email attempts must pass"
done
FOURTH="$(consume "$EMAIL_3" "$IP_3")"
[[ "$FOURTH" =~ ^0:[1-9][0-9]*$ ]] || fail "fourth email attempt must be rate-limited (actual=$FOURTH)"
assert_eq "3" "$(db_value "SELECT attempt_count FROM public.password_recovery_rate_limits WHERE scope = 'email' AND key_hash = '$EMAIL_3';")" "denied email attempt must not increment"

# عشرة طلبات IP مع مفاتيح بريد مختلفة تقبل والحادي عشر يرفض.
IP_10="$(printf 'c%.0s' {1..64})"
for i in $(seq 1 10); do
  email_key="$(printf '%064x' "$i")"
  assert_eq "1:0" "$(consume "$email_key" "$IP_10")" "first ten IP attempts must pass"
done
IP_ELEVEN_EMAIL="$(printf '%064x' 11)"
ELEVENTH="$(consume "$IP_ELEVEN_EMAIL" "$IP_10")"
[[ "$ELEVENTH" =~ ^0:[1-9][0-9]*$ ]] || fail "eleventh IP attempt must be rate-limited (actual=$ELEVENTH)"
assert_eq "10" "$(db_value "SELECT attempt_count FROM public.password_recovery_rate_limits WHERE scope = 'ip' AND key_hash = '$IP_10';")" "denied IP attempt must not increment"

# صف منتهٍ لا يعتمد على cleanup: ON CONFLICT يعيد نافذته وعداده إلى 1 بذرياً.
EMAIL_EXPIRY="$(printf 'd%.0s' {1..64})"
IP_EXPIRY="$(printf 'e%.0s' {1..64})"
assert_eq "1:0" "$(consume "$EMAIL_EXPIRY" "$IP_EXPIRY")" "initial expiry scenario request must pass"
db_value "UPDATE public.password_recovery_rate_limits SET window_started_at = now() - interval '16 minutes', expires_at = now() - interval '1 second' WHERE key_hash IN ('$EMAIL_EXPIRY', '$IP_EXPIRY');" >/dev/null
assert_eq "1:0" "$(consume "$EMAIL_EXPIRY" "$IP_EXPIRY")" "expired window must start again"
assert_eq "{1,1}" "$(db_value "SELECT array_agg(attempt_count ORDER BY scope)::text FROM public.password_recovery_rate_limits WHERE key_hash IN ('$EMAIL_EXPIRY', '$IP_EXPIRY');")" "expired rows must reset to one"
assert_eq "t" "$(db_value "SELECT bool_and(expires_at > now()) FROM public.password_recovery_rate_limits WHERE key_hash IN ('$EMAIL_EXPIRY', '$IP_EXPIRY');")" "reset windows must expire in the future"

# cleanup منفصل ومحدود (100 صف) ويستفيد من فهرس expires_at بدلاً من حذف عالمي في consume.
db_value "INSERT INTO public.password_recovery_rate_limits (scope, key_hash, attempt_count, window_started_at, expires_at) SELECT 'email', lpad(to_hex(10000 + n), 64, '0'), 1, now() - interval '16 minutes', now() - interval '1 second' FROM generate_series(1, 125) AS n;" >/dev/null
assert_eq "100" "$(db_value "SET ROLE service_role; SELECT public.cleanup_password_recovery_rate_limits();")" "cleanup first batch must be bounded"
assert_eq "25" "$(db_value "SET ROLE service_role; SELECT public.cleanup_password_recovery_rate_limits();")" "cleanup second batch must finish remainder"

# 20 عميلًا متزامناً للمفتاحين نفسيهما: الأقفال المرتبة تمنع تجاوز حد البريد 3.
EMAIL_CONCURRENT="$(printf 'f%.0s' {1..64})"
IP_CONCURRENT="$(printf '0%.0s' {1..63})1"
CONCURRENT_SQL="SET ROLE service_role; SELECT (allowed::int)::text || ':' || retry_after_seconds::text FROM public.consume_password_recovery_rate_limit('$EMAIL_CONCURRENT', '$IP_CONCURRENT');"
pids=()
for i in $(seq 1 20); do
  ("${PSQL[@]}" -qAtc "$CONCURRENT_SQL" >"$RESULT_DIR/$i") &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done
allowed_count="$(grep -lx '1:0' "$RESULT_DIR"/* | wc -l | tr -d ' ')"
denied_count="$(grep -El '^0:[1-9][0-9]*$' "$RESULT_DIR"/* | wc -l | tr -d ' ')"
assert_eq "3" "$allowed_count" "only three concurrent email attempts may pass"
assert_eq "17" "$denied_count" "remaining concurrent attempts must be denied"
assert_eq "email:3,ip:3" "$(db_value "SELECT string_agg(scope || ':' || attempt_count::text, ',' ORDER BY scope) FROM public.password_recovery_rate_limits WHERE (scope, key_hash) IN (('email', '$EMAIL_CONCURRENT'), ('ip', '$IP_CONCURRENT'));")" "concurrent counters must not lose or over-count increments"

echo "PASS: PostgreSQL ACL, null keys, 3-email, 10-IP, expiry reset, bounded cleanup, concurrency, and migration idempotence"
