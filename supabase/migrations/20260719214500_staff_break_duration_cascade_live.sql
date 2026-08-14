-- When admin sets break duration at a parent scope, clear more-specific
-- active overrides under that scope so employees see the new minutes
-- immediately (user/branch/region overrides were shadowing global/branch edits).

CREATE OR REPLACE FUNCTION public.upsert_staff_break_schedule(
  p_scope_type text,
  p_scope_id uuid,
  p_duration_minutes integer,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_row public.staff_break_schedules%ROWTYPE;
  v_applied integer := 0;
  v_cleared integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  IF p_scope_type NOT IN ('global', 'region', 'branch', 'user') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نطاق غير صالح');
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 480 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المدة يجب أن تكون بين 1 و 480 دقيقة');
  END IF;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يعدل مدد البريك');
  END IF;

  -- Same-scope replace
  UPDATE public.staff_break_schedules
  SET is_active = false, updated_at = now(), updated_by = v_uid
  WHERE is_active
    AND scope_type = p_scope_type
    AND (
      (p_scope_id IS NULL AND scope_id IS NULL)
      OR scope_id = p_scope_id
    );

  -- Clear nested overrides so the new duration actually wins for employees
  IF p_scope_type = 'global' THEN
    UPDATE public.staff_break_schedules
    SET is_active = false, updated_at = now(), updated_by = v_uid
    WHERE is_active
      AND scope_type IN ('region', 'branch', 'user');
    GET DIAGNOSTICS v_cleared = ROW_COUNT;

  ELSIF p_scope_type = 'region' AND p_scope_id IS NOT NULL THEN
    UPDATE public.staff_break_schedules
    SET is_active = false, updated_at = now(), updated_by = v_uid
    WHERE is_active
      AND (
        (scope_type = 'branch' AND scope_id IN (
          SELECT b.id FROM public.branches b WHERE b.region_id = p_scope_id
        ))
        OR (scope_type = 'user' AND scope_id IN (
          SELECT u.id
          FROM public.users u
          JOIN public.branches b ON b.id = u.branch_id
          WHERE b.region_id = p_scope_id
        ))
      );
    GET DIAGNOSTICS v_cleared = ROW_COUNT;

  ELSIF p_scope_type = 'branch' AND p_scope_id IS NOT NULL THEN
    UPDATE public.staff_break_schedules
    SET is_active = false, updated_at = now(), updated_by = v_uid
    WHERE is_active
      AND scope_type = 'user'
      AND scope_id IN (
        SELECT u.id FROM public.users u WHERE u.branch_id = p_scope_id
      );
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  INSERT INTO public.staff_break_schedules (
    scope_type, scope_id, duration_minutes, label, created_by, updated_by
  ) VALUES (
    p_scope_type,
    CASE WHEN p_scope_type = 'global' THEN NULL ELSE p_scope_id END,
    p_duration_minutes,
    NULLIF(trim(COALESCE(p_label, '')), ''),
    v_uid,
    v_uid
  )
  RETURNING * INTO v_row;

  v_applied := public.apply_staff_break_duration_to_open(
    p_scope_type,
    CASE WHEN p_scope_type = 'global' THEN NULL ELSE p_scope_id END,
    p_duration_minutes
  );

  RETURN jsonb_build_object(
    'ok', true,
    'schedule', to_jsonb(v_row),
    'applied_sessions', v_applied,
    'cleared_overrides', v_cleared
  );
END;
$function$;

COMMENT ON FUNCTION public.upsert_staff_break_schedule(text, uuid, integer, text) IS
  'Upsert break schedule duration by scope (admin only). Clears nested overrides so employees pick up the new minutes immediately.';
