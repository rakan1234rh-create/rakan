-- Security hardening for public.users.
-- The browser may read its own complete profile, including when disabled, so it can
-- show the disabled-account state and sign out cleanly. Only active administrators
-- and active delegated manage_users holders may read or manage other profiles.
BEGIN;

-- 1) Replace broad read/update policies. Do not put current_user_is_active() on
-- self SELECT: that would hide the disabled user's own profile and break the UI's
-- disabled-account detection. It remains mandatory for every mutation and for
-- reading another user's record.
DROP POLICY IF EXISTS users_read_all ON public.users;
DROP POLICY IF EXISTS users_read_self ON public.users;
DROP POLICY IF EXISTS users_read_self_or_manage ON public.users;

CREATE POLICY users_read_self_or_manage
  ON public.users
  FOR SELECT
  TO authenticated
  USING (
    auth_uid = auth.uid()
    OR (
      public.current_user_is_active()
      AND (
        public.current_user_role() = 'admin'
        OR public.user_has_platform_perm('manage_users')
      )
    )
  );

DROP POLICY IF EXISTS users_update ON public.users;
DROP POLICY IF EXISTS users_update_admin_or_self ON public.users;
DROP POLICY IF EXISTS users_update_admin_manage_or_self ON public.users;

CREATE POLICY users_update_admin_manage_or_self
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      auth_uid = auth.uid()
      OR public.current_user_role() = 'admin'
      OR public.user_has_platform_perm('manage_users')
    )
  )
  WITH CHECK (
    public.current_user_is_active()
    AND (
      auth_uid = auth.uid()
      OR public.current_user_role() = 'admin'
      OR public.user_has_platform_perm('manage_users')
    )
  );

DROP POLICY IF EXISTS users_insert ON public.users;
DROP POLICY IF EXISTS users_insert_admin ON public.users;
DROP POLICY IF EXISTS users_insert_admin_or_manage ON public.users;

CREATE POLICY users_insert_admin_or_manage
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_is_active()
    AND (
      public.current_user_role() = 'admin'
      OR public.user_has_platform_perm('manage_users')
    )
  );

DROP POLICY IF EXISTS users_delete ON public.users;
DROP POLICY IF EXISTS users_delete_admin ON public.users;
DROP POLICY IF EXISTS users_delete_admin_or_manage ON public.users;

CREATE POLICY users_delete_admin_or_manage
  ON public.users
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      public.current_user_role() = 'admin'
      OR public.user_has_platform_perm('manage_users')
    )
  );

-- RLS does not protect TRUNCATE, REFERENCES, or TRIGGER. Keep the ordinary
-- authenticated SELECT/INSERT/UPDATE/DELETE grants for the policies above, but
-- remove these bypass-capable table privileges explicitly.
REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.users FROM PUBLIC, anon, authenticated;

-- 2) A self-service update is intentionally limited to avatar_key. RLS works at
-- row level, so this trigger also protects against a future policy accidentally
-- widening the updateable columns. Service-role/migration calls have no JWT and
-- keep the existing trusted administration workflow.
CREATE OR REPLACE FUNCTION public.athar_guard_users_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.current_user_is_active()
     AND (
       public.current_user_role() = 'admin'
       OR public.user_has_platform_perm('manage_users')
     ) THEN
    RETURN NEW;
  END IF;

  IF OLD.auth_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'لا يمكنك تعديل ملف مستخدم آخر'
      USING ERRCODE = '42501';
  END IF;

  -- updated_at is maintained by the existing touch trigger. avatar_key is the
  -- sole field written by the current self-profile UI.
  IF (to_jsonb(NEW) - ARRAY['avatar_key', 'updated_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['avatar_key', 'updated_at']) THEN
    RAISE EXCEPTION 'تعديل الحقول الحساسة في ملفك غير مسموح'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger functions must not be directly executable by browser roles. PostgreSQL
-- invokes the function through the trigger; no client EXECUTE grant is required.
REVOKE ALL ON FUNCTION public.athar_guard_users_sensitive() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.athar_guard_users_sensitive() FROM anon, authenticated;

-- The renamed migration created this trigger only when its earlier transition
-- succeeded. Recreate it here idempotently so this guard never remains merely a
-- dormant function.
DROP TRIGGER IF EXISTS athar_guard_users_sensitive_trg ON public.users;
CREATE TRIGGER athar_guard_users_sensitive_trg
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.athar_guard_users_sensitive();

-- 3) Limited active-user directory for non-management screens. It deliberately
-- omits email, phone, auth_uid and employee_number. The UI's employee-number
-- filter/export/manage views request the full map only after canManageUsers();
-- profile-avatar editing uses the signed-in user's own profile, not this map.
CREATE OR REPLACE FUNCTION public.get_user_directory()
RETURNS TABLE (
  id uuid,
  name text,
  role public.user_role,
  branch_id uuid,
  department_id uuid,
  job_title text,
  avatar_key text,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_active() THEN
    RAISE EXCEPTION 'يلزم حساب نشط لقراءة دليل الموظفين'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.name,
    u.role,
    u.branch_id,
    u.department_id,
    u.job_title,
    u.avatar_key,
    u.is_active
  FROM public.users AS u
  WHERE u.is_active IS TRUE
  ORDER BY u.name, u.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_directory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_directory() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_directory() TO authenticated, service_role;

-- The old RPC disclosed an active employee's email before password verification.
-- DROP IF EXISTS is safe on deployments where the legacy RPC was already absent;
-- do not REVOKE it first because that would fail when absent.
DROP FUNCTION IF EXISTS public.get_email_by_emp_number(text);

-- 4) Server-only, bounded employee-login limiter. The Edge Function stores
-- HMAC-SHA-256 keys using EMPLOYEE_LOGIN_RATE_LIMIT_SALT (never raw employee
-- numbers/IPs and never the service-role credential). Counters are not cleared on
-- successful sign-in, so a valid account cannot reset a shared IP's guess budget.
CREATE TABLE IF NOT EXISTS public.employee_login_rate_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_until timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_login_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.employee_login_rate_limits FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.employee_login_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_employee_login_rate_limit(p_key_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_allowed boolean;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'مفتاح حد المحاولات غير صالح'
      USING ERRCODE = '22023';
  END IF;

  -- Bound retained pseudonymous keys even if no cleanup job runs separately.
  DELETE FROM public.employee_login_rate_limits
  WHERE key_hash IN (
    SELECT key_hash
    FROM public.employee_login_rate_limits
    WHERE expires_at <= v_now
    ORDER BY expires_at
    LIMIT 100
  );

  INSERT INTO public.employee_login_rate_limits AS l (
    key_hash,
    window_started_at,
    attempt_count,
    blocked_until,
    expires_at,
    updated_at
  )
  VALUES (p_key_hash, v_now, 1, NULL, v_now + interval '1 hour', v_now)
  ON CONFLICT (key_hash) DO UPDATE
  SET
    window_started_at = CASE
      WHEN l.window_started_at <= v_now - interval '15 minutes' THEN v_now
      ELSE l.window_started_at
    END,
    attempt_count = CASE
      WHEN l.window_started_at <= v_now - interval '15 minutes' THEN 1
      WHEN l.blocked_until IS NOT NULL AND l.blocked_until > v_now THEN l.attempt_count
      ELSE l.attempt_count + 1
    END,
    blocked_until = CASE
      WHEN l.window_started_at <= v_now - interval '15 minutes' THEN NULL
      WHEN l.blocked_until IS NOT NULL AND l.blocked_until > v_now THEN l.blocked_until
      WHEN l.attempt_count >= 5 THEN v_now + interval '15 minutes'
      ELSE NULL
    END,
    expires_at = v_now + interval '1 hour',
    updated_at = v_now
  RETURNING blocked_until IS NULL INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_employee_login_rate_limit(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_employee_login_rate_limit(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_employee_login_rate_limit(text) TO service_role;

COMMIT;
