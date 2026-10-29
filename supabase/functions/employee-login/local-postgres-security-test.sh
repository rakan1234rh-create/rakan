#!/usr/bin/env bash
# Isolated, disposable PostgreSQL verification for 20261012202000_security_users.sql.
# It never reads a project database or Supabase credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/athar-users-pg.XXXXXX")"
SOCKET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/athar-users-pg-socket.XXXXXX")"
PORT="${ATHAR_LOCAL_PG_PORT:-55432}"
PSQL=("${PG_BIN}/psql" -h "${SOCKET_DIR}" -p "${PORT}" -U postgres -v ON_ERROR_STOP=1 -X -q)

cleanup() {
  if [[ -f "${DATA_DIR}/postmaster.pid" ]]; then
    "${PG_BIN}/pg_ctl" -D "${DATA_DIR}" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "${DATA_DIR}"
  rm -rf "${SOCKET_DIR}"
}
trap cleanup EXIT

if "${PG_BIN}/pg_isready" -h "${SOCKET_DIR}" -p "${PORT}" >/dev/null 2>&1; then
  echo "refusing to use occupied local PostgreSQL port ${PORT}" >&2
  exit 1
fi

"${PG_BIN}/initdb" -D "${DATA_DIR}" -A trust -U postgres --no-locale >/dev/null
if ! "${PG_BIN}/pg_ctl" -D "${DATA_DIR}" -o "-k '${SOCKET_DIR}' -p ${PORT} -c listen_addresses=''" -l "${DATA_DIR}/postgres.log" -w start >/dev/null; then
  cat "${DATA_DIR}/postgres.log" >&2
  exit 1
fi

"${PSQL[@]}" <<'SQL'
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE public.user_role AS ENUM (
  'admin', 'manager', 'auditor', 'supervisor', 'employee', 'observer', 'branch_manager', 'hr'
);
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  employee_number text UNIQUE NOT NULL,
  auth_uid uuid UNIQUE,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  role public.user_role NOT NULL DEFAULT 'employee',
  branch_id uuid,
  department_id uuid,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  job_title text,
  avatar_key text
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users TO anon, authenticated;

CREATE FUNCTION public.current_user_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT COALESCE((SELECT u.is_active IS TRUE FROM public.users AS u WHERE u.auth_uid = auth.uid()), false)
$$;
CREATE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT u.role::text FROM public.users AS u WHERE u.auth_uid = auth.uid()
$$;
CREATE FUNCTION public.user_has_platform_perm(text)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

INSERT INTO public.users (id, employee_number, auth_uid, name, email, role, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000011', '00011', '00000000-0000-0000-0000-000000000001', 'Active', 'active@example.test', 'employee', true),
  ('00000000-0000-0000-0000-000000000022', '00022', '00000000-0000-0000-0000-000000000002', 'Disabled', 'disabled@example.test', 'employee', false),
  ('00000000-0000-0000-0000-000000000033', '00033', '00000000-0000-0000-0000-000000000003', 'Other', 'other@example.test', 'employee', true);
SQL

"${PSQL[@]}" -f "${ROOT}/supabase/migrations/20261012202000_security_users.sql"

"${PSQL[@]}" -At <<'SQL' | grep -qx 't|t|t'
SELECT
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.users'::regclass
      AND tgname = 'athar_guard_users_sensitive_trg'
      AND NOT tgisinternal
  ),
  NOT has_table_privilege('authenticated', 'public.users', 'TRUNCATE'),
  NOT has_table_privilege('authenticated', 'public.users', 'REFERENCES');
SQL

# A disabled user must be able to read only their own row so the frontend can
# identify the disabled state. They still cannot read another profile.
"${PSQL[@]}" -At <<'SQL' | grep -qx '1|0'
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SELECT
  (SELECT count(*) FROM public.users),
  (SELECT count(*) FROM public.users WHERE auth_uid = '00000000-0000-0000-0000-000000000003');
SQL

# Self-service avatar is allowed, but changing a sensitive field is rejected by
# the actual trigger even if an UPDATE policy is later widened accidentally.
"${PSQL[@]}" <<'SQL'
BEGIN;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
UPDATE public.users SET avatar_key = 'portrait_1' WHERE auth_uid = auth.uid();
DO $block$
BEGIN
  UPDATE public.users SET name = 'must-not-change' WHERE auth_uid = auth.uid();
  RAISE EXCEPTION 'sensitive self update unexpectedly succeeded';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$block$;
ROLLBACK;
SQL

# Apply the retry_after shape migration used by the lockout wait message.
"${PSQL[@]}" -f "${ROOT}/supabase/migrations/20261029193000_employee_login_rate_limit_retry_after.sql" >/dev/null

# The first five attempts are accepted; the sixth enters a 15-minute block
# and exposes a positive retry_after_seconds for the UI minute figure.
"${PSQL[@]}" -At <<'SQL' | grep -qx 'true|true|true|true|true|false'
SET ROLE service_role;
SELECT string_agg(allowed::text, '|' ORDER BY n)
FROM generate_series(1, 6) AS n,
LATERAL public.consume_employee_login_rate_limit(repeat('b', 64));
SQL

"${PSQL[@]}" -At <<'SQL' | grep -Eq '^[0-9]+$'
SET ROLE service_role;
SELECT retry_after_seconds
FROM public.consume_employee_login_rate_limit(repeat('b', 64))
WHERE allowed = false;
SQL

echo 'local PostgreSQL users security test: PASS'
