-- Align R2 attachment reads with the actual violations SELECT visibility.
-- This changes authorization only; it does not alter attachment paths or objects.
BEGIN;

CREATE OR REPLACE FUNCTION public.athar_attachment_can_read(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  ok boolean;
BEGIN
  IF auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()
     OR NOT public.athar_attachment_key_is_valid(p_key) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.violations v
    WHERE (
      public.athar_attachment_json_has_key(v.attachments, p_key)
      OR public.athar_attachment_logs_have_key(v.logs, p_key)
      OR public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
    )
    AND (
      -- Keep this in lockstep with the SELECT policies on violations.
      v_role IN ('admin', 'manager', 'auditor')
      OR public.user_has_platform_perm('view_all_tickets')
      OR (v_role = 'hr' AND v.state::text = 'hr')
      OR (v_role = 'employee' AND v.employee_id = v_uid)
      OR (v_role = 'observer' AND v.observer_id = v_uid)
      OR (v_role = 'supervisor' AND v.branch_id = ANY(public.current_user_supervised_branches()))
      OR (v_role = 'branch_manager' AND (
        v.employee_id = v_uid
        OR v.branch_id = public.current_user_branch_id()
      ))
    )
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
      OR EXISTS (
        SELECT 1
        FROM public.athar_r2_legacy_attachment_keys l
        WHERE l.record_type = 'violation'
          AND l.record_id = v.id
          AND l.object_key = p_key
      )
      -- Temporary keys are readable only when attached to a visible record.
      OR p_key LIKE 'temp_%'
    )
  ) INTO ok;

  IF ok THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.complaints c
    WHERE (
      public.athar_attachment_json_has_key(c.attachments, p_key)
      OR public.athar_attachment_logs_have_key(c.logs, p_key)
      OR public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
    )
    AND (v_role = 'admin' OR c.employee_id = v_uid)
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
      OR EXISTS (
        SELECT 1
        FROM public.athar_r2_legacy_attachment_keys l
        WHERE l.record_type = 'complaint'
          AND l.record_id = c.id
          AND l.object_key = p_key
      )
      OR p_key LIKE 'temp_%'
    )
  ) INTO ok;

  RETURN COALESCE(ok, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.athar_attachment_can_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athar_attachment_can_read(text) TO authenticated, service_role;

COMMIT;
