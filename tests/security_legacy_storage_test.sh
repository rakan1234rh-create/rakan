#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="$(pg_config --bindir)"
ROOT="$(mktemp -d /tmp/athar-legacy-test.XXXXXX)"
DATA="$ROOT/data"
SOCKET="$ROOT/socket"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
MIGRATION="$REPO_ROOT/supabase/migrations/20261012204000_security_legacy_storage.sql"
PSQL=(psql -h "$SOCKET" -p "$PORT" -d postgres -v ON_ERROR_STOP=1)

OWNER=11111111-1111-1111-1111-111111111111
OTHER=22222222-2222-2222-2222-222222222222
INACTIVE=33333333-3333-3333-3333-333333333333
ADMIN=44444444-4444-4444-4444-444444444444
INACTIVE_ADMIN=55555555-5555-5555-5555-555555555555

cleanup() {
  if [ -f "$DATA/postmaster.pid" ]; then
    "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT
rm -rf "$ROOT"
mkdir -p "$ROOT" "$SOCKET"
"$PGBIN/initdb" -D "$DATA" -A trust --no-locale >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-k $SOCKET -p $PORT" -w start >/dev/null

cat > "$ROOT/bootstrap.sql" <<SQL
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE public.users (
  auth_uid uuid PRIMARY KEY,
  is_active boolean NOT NULL,
  role text NOT NULL
);
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL,
  owner uuid,
  owner_id text
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS \$\$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
\$\$;
CREATE FUNCTION public.current_user_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS \$\$
  SELECT COALESCE((SELECT u.is_active FROM public.users AS u WHERE u.auth_uid = auth.uid() LIMIT 1), false);
\$\$;
CREATE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS \$\$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS u
    WHERE u.auth_uid = auth.uid()
      AND u.is_active
      AND lower(trim(u.role)) IN ('admin', 'administrator', 'super_admin', 'sysadmin')
  );
\$\$;
GRANT USAGE ON SCHEMA auth, storage, public TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
CREATE POLICY "Authenticated users can upload"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'violation-attachments');
CREATE POLICY "Authenticated can delete own"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'violation-attachments');
INSERT INTO public.users (auth_uid, is_active, role) VALUES
  ('$OWNER', true, 'employee'),
  ('$OTHER', true, 'employee'),
  ('$INACTIVE', false, 'employee'),
  ('$ADMIN', true, 'admin'),
  ('$INACTIVE_ADMIN', false, 'admin');
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('violation-attachments', 'violation-attachments', true, NULL, NULL);
INSERT INTO storage.objects (bucket_id, name, owner_id, owner) VALUES
  ('violation-attachments', 'owner-modern', '$OWNER', NULL),
  ('violation-attachments', 'owner-legacy', NULL, '$OWNER'),
  ('violation-attachments', 'other-modern', '$OTHER', NULL),
  ('violation-attachments', 'orphan', NULL, NULL);
SQL
"${PSQL[@]}" -f "$ROOT/bootstrap.sql" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

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
  local label=$1 sql=$2
  local output
  if output=$("${PSQL[@]}" -Atqc "$sql" 2>&1); then
    printf 'FAIL %s: command unexpectedly succeeded: %s\n' "$label" "$output" >&2
    exit 1
  fi
  printf 'PASS %s (blocked)\n' "$label"
}

as_authenticated() {
  local uid=$1 statement=$2
  printf "BEGIN; SET LOCAL request.jwt.claim.sub = '%s'; SET LOCAL ROLE authenticated; %s ROLLBACK;" "$uid" "$statement"
}

assert_equals \
  'bucket_is_private_with_limits_and_mime' \
  'false|52428800|image/jpeg,image/png,image/webp,application/pdf' \
  "SELECT public::text || '|' || file_size_limit::text || '|' || array_to_string(allowed_mime_types, ',') FROM storage.buckets WHERE id = 'violation-attachments';"
assert_equals \
  'only_three_new_object_policies' \
  'legacy_violation_attachments_delete_own_or_admin,legacy_violation_attachments_insert_own,legacy_violation_attachments_select_own_or_admin' \
  "SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';"
assert_equals \
  'active_owner_reads_owner_id_and_legacy_owner' \
  'owner-legacy,owner-modern' \
  "$(as_authenticated "$OWNER" "SELECT string_agg(name, ',' ORDER BY name) FROM storage.objects;")"
assert_equals \
  'active_other_user_cannot_read_owner_objects' \
  'other-modern' \
  "$(as_authenticated "$OTHER" "SELECT string_agg(name, ',' ORDER BY name) FROM storage.objects;")"
assert_equals \
  'inactive_owner_cannot_read' \
  '0' \
  "$(as_authenticated "$INACTIVE" "SELECT count(*) FROM storage.objects;")"
assert_equals \
  'active_admin_can_read_for_legacy_management' \
  '4' \
  "$(as_authenticated "$ADMIN" "SELECT count(*) FROM storage.objects;")"
assert_equals \
  'inactive_admin_cannot_use_management_exception' \
  '0' \
  "$(as_authenticated "$INACTIVE_ADMIN" "SELECT count(*) FROM storage.objects;")"
assert_equals \
  'active_owner_insert_with_owner_id' \
  '1' \
  "$(as_authenticated "$OWNER" "INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('violation-attachments', 'new-owner-file', '$OWNER') RETURNING 1;")"
assert_equals \
  'active_owner_cannot_delete_other_object' \
  '' \
  "$(as_authenticated "$OWNER" "DELETE FROM storage.objects WHERE name = 'other-modern' RETURNING name;")"
assert_equals \
  'active_admin_can_delete_orphan_for_legacy_management' \
  'orphan' \
  "$(as_authenticated "$ADMIN" "DELETE FROM storage.objects WHERE name = 'orphan' RETURNING name;")"
assert_equals \
  'inactive_owner_cannot_delete_own_object' \
  '' \
  "$(as_authenticated "$INACTIVE" "DELETE FROM storage.objects WHERE name = 'owner-modern' RETURNING name;")"
assert_equals \
  'no_update_policy_blocks_direct_overwrite' \
  '' \
  "$(as_authenticated "$OWNER" "UPDATE storage.objects SET name = 'overwritten' WHERE name = 'owner-modern' RETURNING name;")"
assert_fails \
  'active_owner_cannot_insert_for_other_owner' \
  "$(as_authenticated "$OWNER" "INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('violation-attachments', 'spoofed-file', '$OTHER');")"
assert_fails \
  'anon_has_no_object_privilege' \
  "BEGIN; SET LOCAL request.jwt.claim.sub = '$OWNER'; SET LOCAL ROLE anon; SELECT count(*) FROM storage.objects; ROLLBACK;"

printf 'ALL LOCAL MIGRATION/RLS TESTS PASSED\n'
