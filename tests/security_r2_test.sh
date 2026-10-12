#!/usr/bin/env bash
# Local isolated integration test for 20261012203000_security_r2.sql.
# It creates its own PostgreSQL cluster; it never contacts Supabase or R2.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$REPO_ROOT/supabase/migrations/20261012203000_security_r2.sql"
PGBIN="$(pg_config --bindir)"
ROOT="$(mktemp -d /tmp/athar-r2-test.XXXXXX)"
DATA="$ROOT/data"
SOCKET="$ROOT/socket"
PORT="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$SOCKET" -p "$PORT" -d postgres)

OWNER=11111111-1111-1111-1111-111111111111
OTHER=22222222-2222-2222-2222-222222222222
ADMIN=33333333-3333-3333-3333-333333333333
INACTIVE=44444444-4444-4444-4444-444444444444
V_LEGACY=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1
V_CANON=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2
V_TEMP=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3
V_CREATE=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4
V_FINAL=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5
V_ROLL=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6
V_AFTER=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7
C_LEGACY=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1

cleanup() {
  if [[ -f "$DATA/postmaster.pid" ]]; then
    "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

[[ -f "$MIGRATION" ]] || { echo "missing migration: $MIGRATION" >&2; exit 1; }
mkdir -p "$SOCKET"
"$PGBIN/initdb" -D "$DATA" -A trust --no-locale -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-F -k $SOCKET -p $PORT" -w start >/dev/null

assert_equals() {
  local label=$1 expected=$2 sql=$3 actual
  actual=$("${PSQL[@]}" -Atqc "$sql")
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL %s: expected [%s], got [%s]\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'PASS %s = %s\n' "$label" "${actual:-<empty>}"
}

assert_fails() {
  local label=$1 sql=$2 output
  if output=$("${PSQL[@]}" -Atqc "$sql" 2>&1); then
    printf 'FAIL %s: unexpectedly succeeded: %s\n' "$label" "$output" >&2
    exit 1
  fi
  printf 'PASS %s (blocked)\n' "$label"
}

as_authenticated() {
  local uid=$1 statement=$2
  printf "BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '%s'; %s ROLLBACK;" "$uid" "$statement"
}

"${PSQL[@]}" >/dev/null <<SQL
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT anon, authenticated, service_role TO CURRENT_USER;
CREATE SCHEMA auth;
CREATE EXTENSION pgcrypto;

CREATE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS \$\$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
\$\$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  auth_uid uuid UNIQUE NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL,
  branch_id uuid
);
CREATE TABLE public.violations (
  id uuid PRIMARY KEY,
  employee_id uuid NOT NULL,
  branch_id uuid,
  observer_id uuid,
  source_role text NOT NULL DEFAULT 'employee',
  state text NOT NULL DEFAULT 'emp',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY,
  employee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS \$\$
  SELECT u.id FROM public.users u WHERE u.auth_uid = auth.uid()
\$\$;
CREATE FUNCTION public.current_user_is_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS \$\$
  SELECT COALESCE((SELECT u.is_active FROM public.users u WHERE u.auth_uid = auth.uid()), false)
\$\$;
CREATE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS \$\$
  SELECT u.role FROM public.users u WHERE u.auth_uid = auth.uid()
\$\$;
CREATE FUNCTION public.current_user_supervised_branches() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS \$\$
  SELECT ARRAY[]::uuid[]
\$\$;
CREATE FUNCTION public.user_has_platform_perm(text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS \$\$
  SELECT false
\$\$;

ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.violations, public.complaints TO authenticated;
CREATE POLICY violations_select ON public.violations
  FOR SELECT TO authenticated
  USING (public.current_user_is_active() AND (
    employee_id = public.current_user_id() OR public.current_user_role() = 'admin'
  ));
CREATE POLICY violations_update ON public.violations
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active() AND employee_id = public.current_user_id())
  WITH CHECK (public.current_user_is_active() AND employee_id = public.current_user_id());
CREATE POLICY complaints_select ON public.complaints
  FOR SELECT TO authenticated
  USING (public.current_user_is_active() AND (
    employee_id = public.current_user_id() OR public.current_user_role() = 'admin'
  ));
CREATE POLICY complaints_update ON public.complaints
  FOR UPDATE TO authenticated
  USING (public.current_user_is_active() AND employee_id = public.current_user_id())
  WITH CHECK (public.current_user_is_active() AND employee_id = public.current_user_id());

INSERT INTO public.users (id, auth_uid, role, is_active) VALUES
  ('$OWNER', '$OWNER', 'employee', true),
  ('$OTHER', '$OTHER', 'employee', true),
  ('$ADMIN', '$ADMIN', 'admin', true),
  ('$INACTIVE', '$INACTIVE', 'employee', false);
INSERT INTO public.violations (id, employee_id, observer_id, source_role, state, attachments, logs) VALUES
  ('$V_LEGACY', '$OWNER', '$OWNER', 'employee', 'emp',
   '[{"p":"legacy/v-main.pdf"}]', '[{"attachments":[{"path":"legacy/v-log.pdf"}]}]'),
  ('$V_CANON', '$OWNER', '$OWNER', 'employee', 'emp',
   '[{"p":"violations/$V_CANON/canonical.pdf"}]', '[]'),
  ('$V_TEMP', '$OWNER', '$OWNER', 'employee', 'emp',
   '[{"p":"temp_${OWNER}_nonce/temp.pdf"}]', '[]'),
  ('$V_CREATE', '$OWNER', '$OWNER', 'employee', 'emp', '[]', '[]'),
  ('$V_FINAL', '$OWNER', '$OWNER', 'employee', 'emp',
   '[{"p":"temp_${OWNER}_nonce/final.pdf"}]', '[]'),
  ('$V_ROLL', '$OWNER', '$OWNER', 'employee', 'emp',
   '[{"p":"temp_${OWNER}_nonce/roll.pdf"}]', '[]'),
  ('$V_AFTER', '$OWNER', '$OWNER', 'employee', 'emp', '[]', '[]');
INSERT INTO public.complaints (id, employee_id, status, attachments, logs) VALUES
  ('$C_LEGACY', '$OWNER', 'pending',
   '[{"p":"legacy/c-main.pdf"}]', '[{"attachments":[{"path":"legacy/c-log.pdf"}]}]');
SQL

# First application freezes only the initial historical references.
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

assert_equals 'nul_check_removed_and_key_validation_still_works' 'true' \
  "SELECT public.athar_attachment_key_is_valid('violations/$V_CANON/canonical.pdf')::text;"
assert_equals 'legacy_snapshot_has_initial_paths' '4' \
  "SELECT count(*)::text FROM public.athar_r2_legacy_attachment_keys;"
assert_equals 'freeze_marker_written_once' '1' \
  "SELECT count(*)::text FROM public.athar_r2_legacy_attachment_freeze_marker;"
assert_equals 'immutability_and_stability_are_correct' 'i|s|s' \
  "SELECT (SELECT provolatile::text FROM pg_proc WHERE oid = 'public.athar_attachment_key_is_valid(text)'::regprocedure) || '|' || (SELECT provolatile::text FROM pg_proc WHERE oid = 'public.athar_attachment_is_frozen_legacy_key(text,uuid,text)'::regprocedure) || '|' || (SELECT provolatile::text FROM pg_proc WHERE oid = 'public.athar_attachment_can_read(text)'::regprocedure);"
assert_equals 'read_gate_is_nonlogin_inherited_authenticated_member' 'false|true|true' \
  "SELECT rolcanlogin::text || '|' || rolinherit::text || '|' || pg_has_role('athar_r2_read_gate', 'authenticated', 'member')::text FROM pg_roles WHERE rolname = 'athar_r2_read_gate';"

# Read permission: canonical, frozen legacy, log legacy, complaint legacy, and
# current actor's temp key all work only when that actor can select the record.
assert_equals 'owner_reads_canonical' 'true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_can_read('violations/$V_CANON/canonical.pdf')::text;")"
assert_equals 'owner_reads_frozen_violation_legacy' 'true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_can_read('legacy/v-main.pdf')::text;")"
assert_equals 'owner_reads_frozen_violation_log_legacy' 'true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_can_read('legacy/v-log.pdf')::text;")"
assert_equals 'owner_reads_frozen_complaint_legacy' 'true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_can_read('legacy/c-main.pdf')::text;")"
assert_equals 'owner_reads_own_temp_reference' 'true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_can_read('temp_${OWNER}_nonce/temp.pdf')::text;")"
assert_equals 'other_cannot_enumerate_owner_legacy' 'false' \
  "$(as_authenticated "$OTHER" "SELECT public.athar_attachment_can_read('legacy/v-main.pdf')::text;")"
assert_equals 'other_cannot_read_owner_canonical' 'false' \
  "$(as_authenticated "$OTHER" "SELECT public.athar_attachment_can_read('violations/$V_CANON/canonical.pdf')::text;")"
assert_equals 'other_cannot_claim_owner_temp' 'false' \
  "$(as_authenticated "$OTHER" "SELECT public.athar_attachment_can_read('temp_${OWNER}_nonce/temp.pdf')::text;")"
assert_equals 'inactive_account_cannot_read' 'false' \
  "$(as_authenticated "$INACTIVE" "SELECT public.athar_attachment_can_read('legacy/v-main.pdf')::text;")"
assert_equals 'admin_read_routing_respects_rls' 'true' \
  "$(as_authenticated "$ADMIN" "SELECT public.athar_attachment_can_read('legacy/v-main.pdf')::text;")"

# The raw ledger and its stateful predicate remain unavailable to browser roles.
assert_fails 'authenticated_cannot_select_legacy_ledger' \
  "$(as_authenticated "$OWNER" 'SELECT * FROM public.athar_r2_legacy_attachment_keys;')"
assert_fails 'authenticated_cannot_call_frozen_ledger_helper' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_is_frozen_legacy_key('violation', '$V_LEGACY', 'legacy/v-main.pdf');")"
assert_equals 'frozen_helper_acl_is_closed' 'false' \
  "SELECT has_function_privilege('authenticated', 'public.athar_attachment_is_frozen_legacy_key(text,uuid,text)'::regprocedure, 'EXECUTE')::text;"

# Correct actor temp ownership and exact canonical UUID bindings are enforced by
# triggers and the destination/finalizer RPCs.
assert_fails 'foreign_temp_reference_is_rejected' \
  "$(as_authenticated "$OWNER" "UPDATE public.violations SET attachments = jsonb_build_array(jsonb_build_object('p', 'temp_${OTHER}_nonce/forged.pdf')) WHERE id = '$V_CREATE';")"
assert_fails 'foreign_canonical_reference_is_rejected' \
  "$(as_authenticated "$OWNER" "UPDATE public.violations SET attachments = jsonb_build_array(jsonb_build_object('p', 'violations/$V_CANON/forged.pdf')) WHERE id = '$V_CREATE';")"
assert_equals 'owner_temp_reference_is_accepted' '1' \
  "$(as_authenticated "$OWNER" "UPDATE public.violations SET attachments = jsonb_build_array(jsonb_build_object('p', 'temp_${OWNER}_nonce/create.pdf')) WHERE id = '$V_CREATE' RETURNING 1;")"
assert_equals 'owner_canonical_reference_is_accepted' '1' \
  "$(as_authenticated "$OWNER" "UPDATE public.violations SET attachments = jsonb_build_array(jsonb_build_object('p', 'violations/$V_CREATE/create.pdf')) WHERE id = '$V_CREATE' RETURNING 1;")"
assert_equals 'edit_permission_requires_existing_exact_reference' 'false|true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_can_modify('violations/$V_CREATE/create.pdf')::text || '|' || public.athar_attachment_can_modify('violations/$V_CANON/canonical.pdf')::text;")"
assert_equals 'create_destination_requires_correct_record' 'true|false' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_destination_can_modify('violation', '$V_CREATE', 'temp_${OWNER}_nonce/create.pdf', 'violations/$V_CREATE/create.pdf', 'create', NULL)::text || '|' || public.athar_attachment_destination_can_modify('violation', '$V_CANON', 'temp_${OWNER}_nonce/create.pdf', 'violations/$V_CREATE/create.pdf', 'create', NULL)::text;")"
assert_equals 'reply_destination_allows_current_actor_at_correct_target' 'true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_destination_can_modify('violation', '$V_CREATE', 'temp_${OWNER}_nonce/reply.pdf', 'violations/$V_CREATE/reply.pdf', 'reply', 'emp')::text;")"
assert_equals 'finalizer_moves_only_to_own_canonical_target' 'true|false' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_finalize_attachment_path('violation', '$V_FINAL', 'temp_${OWNER}_nonce/final.pdf', 'violations/$V_FINAL/final.pdf', 'create', NULL)::text || '|' || public.athar_finalize_attachment_path('violation', '$V_FINAL', 'temp_${OWNER}_nonce/final.pdf', 'violations/$V_CANON/final.pdf', 'create', NULL)::text;")"
# Persist only this synthetic local fixture to verify the post-commit reference.
"${PSQL[@]}" >/dev/null <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '$OWNER';
SELECT public.athar_finalize_attachment_path('violation', '$V_FINAL', 'temp_${OWNER}_nonce/final.pdf', 'violations/$V_FINAL/final.pdf', 'create', NULL);
COMMIT;
SQL
assert_equals 'finalizer_keeps_exact_final_reference' "violations/$V_FINAL/final.pdf" \
  "SELECT attachments->0->>'p' FROM public.violations WHERE id = '$V_FINAL';"
assert_equals 'rollback_allows_only_unreferenced_final_destination' 'true' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_move_rollback_allowed('violation', '$V_ROLL', 'temp_${OWNER}_nonce/roll.pdf', 'violations/$V_ROLL/roll.pdf', 'create', NULL)::text;")"
"${PSQL[@]}" >/dev/null <<SQL
UPDATE public.violations
SET attachments = '[{"p":"violations/$V_ROLL/roll.pdf"}]'::jsonb
WHERE id = '$V_ROLL';
SQL
assert_equals 'rollback_refuses_committed_final_reference' 'false' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_move_rollback_allowed('violation', '$V_ROLL', 'temp_${OWNER}_nonce/roll.pdf', 'violations/$V_ROLL/roll.pdf', 'create', NULL)::text;")"

# Simulate a reference added after cut-over by trusted maintenance while guards
# are disabled, then run the same migration twice. It must not expand the frozen
# ledger on either reapplication.
"${PSQL[@]}" >/dev/null <<SQL
ALTER TABLE public.violations DISABLE TRIGGER athar_guard_violation_attachment_references_trg;
UPDATE public.violations
SET attachments = '[{"p":"legacy/added-after-freeze.pdf"}]'::jsonb
WHERE id = '$V_AFTER';
ALTER TABLE public.violations ENABLE TRIGGER athar_guard_violation_attachment_references_trg;
SQL
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
assert_equals 'rerun_does_not_expand_legacy_snapshot' '0' \
  "SELECT count(*)::text FROM public.athar_r2_legacy_attachment_keys WHERE object_key = 'legacy/added-after-freeze.pdf';"
assert_equals 'post_freeze_legacy_reference_is_not_readable' 'false' \
  "$(as_authenticated "$OWNER" "SELECT public.athar_attachment_can_read('legacy/added-after-freeze.pdf')::text;")"
assert_equals 'marker_remains_singleton_after_two_reruns' '1' \
  "SELECT count(*)::text FROM public.athar_r2_legacy_attachment_freeze_marker;"

printf 'ALL LOCAL R2 MIGRATION/RLS TESTS PASSED\n'
