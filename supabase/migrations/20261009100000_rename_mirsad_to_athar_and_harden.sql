-- Rename mirsad_* → athar_* (tables, functions, triggers, policies)
-- Keep temporary mirsad_* wrappers for client RPCs during rollout.
-- Also document phase-1 REVOKEs for critical DEFINERs.

BEGIN;

-- 1) Capture transformed function definitions
CREATE TEMP TABLE _athar_fn_renames (
  old_oid oid PRIMARY KEY,
  old_name text NOT NULL,
  new_def text NOT NULL,
  argtypes oidvector NOT NULL,
  proowner oid NOT NULL
);

DO $$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.proargtypes, p.proowner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'mirsad%'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'mirsad_secrets', 'athar_secrets');
    def := replace(def, 'mirsad_cron_runs', 'athar_cron_runs');
    def := replace(def, 'mirsad_', 'athar_');
    INSERT INTO _athar_fn_renames(old_oid, old_name, new_def, argtypes, proowner)
    VALUES (r.oid, r.proname, def, r.proargtypes, r.proowner);
  END LOOP;
END $$;

-- 2) Rename tables first (functions still old names until recreated)
ALTER TABLE IF EXISTS public.mirsad_secrets RENAME TO athar_secrets;
ALTER TABLE IF EXISTS public.mirsad_cron_runs RENAME TO athar_cron_runs;

-- 3) Drop triggers that point at mirsad_* functions (will recreate)
DROP TRIGGER IF EXISTS mirsad_guard_users_sensitive_trg ON public.users;
DROP TRIGGER IF EXISTS mirsad_guard_violations_integrity_trg ON public.violations;
DROP TRIGGER IF EXISTS mirsad_violations_forward_after_trg ON public.violations;
DROP TRIGGER IF EXISTS mirsad_violations_forward_before_trg ON public.violations;

-- 4) Create athar_* functions from transformed defs
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT new_def FROM _athar_fn_renames LOOP
    EXECUTE r.new_def;
  END LOOP;
END $$;

-- 5) Drop old mirsad_* functions (now replaced by athar_*)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'mirsad%'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- 6) Recreate triggers on athar_* functions
CREATE TRIGGER athar_guard_users_sensitive_trg
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.athar_guard_users_sensitive();

CREATE TRIGGER athar_guard_violations_integrity_trg
  BEFORE UPDATE ON public.violations
  FOR EACH ROW EXECUTE FUNCTION public.athar_guard_violations_integrity();

CREATE TRIGGER athar_violations_forward_before_trg
  BEFORE UPDATE ON public.violations
  FOR EACH ROW EXECUTE FUNCTION public.athar_violations_forward_before();

CREATE TRIGGER athar_violations_forward_after_trg
  AFTER UPDATE ON public.violations
  FOR EACH ROW EXECUTE FUNCTION public.athar_violations_forward_after();

-- 7) Rename policies (best-effort; ignore if already renamed)
DO $$
BEGIN
  BEGIN ALTER POLICY admin_full_access_secrets ON public.athar_secrets RENAME TO athar_admin_full_access_secrets; EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN ALTER POLICY admin_full_access_cron_runs ON public.athar_cron_runs RENAME TO athar_admin_full_access_cron_runs; EXCEPTION WHEN undefined_object THEN NULL; END;
  -- older names may still be mirsad_*
  BEGIN ALTER POLICY admin_full_access_secrets ON public.athar_secrets RENAME TO athar_admin_full_access_secrets; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

DO $$
DECLARE
  pol record;
  new_name text;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE 'mirsad%'
  LOOP
    new_name := replace(pol.policyname, 'mirsad_', 'athar_');
    BEGIN
      EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I', pol.policyname, pol.tablename, new_name);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'policy rename skipped: %.% -> % (%)', pol.tablename, pol.policyname, new_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- 8) Compatibility wrappers for anything still calling mirsad_* during deploy
CREATE OR REPLACE FUNCTION public.mirsad_fetch_all_violations(p_limit integer DEFAULT 500)
RETURNS SETOF public.violations
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM public.athar_fetch_all_violations(p_limit);
$$;

CREATE OR REPLACE FUNCTION public.mirsad_user_can_see_attachment(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.athar_user_can_see_attachment(p_key);
$$;

CREATE OR REPLACE FUNCTION public.mirsad_set_secret(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.athar_set_secret(p_key, p_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.mirsad_execute_forward_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.athar_execute_forward_job(p_job_id);
$$;

CREATE OR REPLACE FUNCTION public.mirsad_auto_forward_tick()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.athar_auto_forward_tick();
$$;

-- Harden grants on sensitive athar_* + wrappers
REVOKE ALL ON FUNCTION public.athar_set_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_set_secret(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.mirsad_set_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_set_secret(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.athar_execute_forward_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_execute_forward_job(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mirsad_execute_forward_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_execute_forward_job(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.auto_forward_violations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_forward_violations() TO service_role;

-- Client RPCs: authenticated only (not anon)
REVOKE ALL ON FUNCTION public.athar_fetch_all_violations(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athar_fetch_all_violations(integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mirsad_fetch_all_violations(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mirsad_fetch_all_violations(integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.athar_user_can_see_attachment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.athar_user_can_see_attachment(text) TO authenticated, service_role, anon;
REVOKE ALL ON FUNCTION public.mirsad_user_can_see_attachment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mirsad_user_can_see_attachment(text) TO authenticated, service_role, anon;

COMMIT;
