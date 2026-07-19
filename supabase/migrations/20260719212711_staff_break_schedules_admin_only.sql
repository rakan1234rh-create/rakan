-- Restrict staff break schedule duration edits to system admin only.
-- Supervisors retain break session visibility/history tools, but cannot
-- change default break duration (global / region / branch / user).

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

  UPDATE public.staff_break_schedules
  SET is_active = false, updated_at = now(), updated_by = v_uid
  WHERE is_active
    AND scope_type = p_scope_type
    AND (
      (p_scope_id IS NULL AND scope_id IS NULL)
      OR scope_id = p_scope_id
    );

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
    'applied_sessions', v_applied
  );
END;
$function$;

COMMENT ON FUNCTION public.upsert_staff_break_schedule(text, uuid, integer, text) IS
  'Upsert break schedule duration by scope. System admin only.';
