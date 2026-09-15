-- Admin-only force-stop for an employee break that has exceeded its duration.
CREATE OR REPLACE FUNCTION public.admin_force_end_staff_break(p_break_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_row public.staff_breaks%ROWTYPE;
  v_elapsed integer;
  v_remaining integer;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  IF public.current_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'إيقاف البريك المتجاوز متاح لمدير النظام فقط');
  END IF;

  SELECT * INTO v_row
  FROM public.staff_breaks
  WHERE id = p_break_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد بريك نشط');
  END IF;

  v_elapsed := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_row.started_at)))::integer);
  v_remaining := COALESCE(v_row.remaining_seconds, v_row.planned_duration_minutes * 60) - v_elapsed;

  IF v_remaining >= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'يمكن الإيقاف الإداري فقط بعد تجاوز مدة البريك',
      'remaining_seconds', v_remaining
    );
  END IF;

  UPDATE public.staff_breaks
  SET
    status = 'ended',
    ended_at = now(),
    paused_at = NULL,
    remaining_seconds = v_remaining,
    used_seconds = COALESCE(used_seconds, 0) + v_elapsed,
    overtime_seconds = ABS(v_remaining),
    overtime_reason = COALESCE(
      NULLIF(trim(COALESCE(v_row.overtime_reason, '')), ''),
      'إيقاف إداري من مدير النظام'
    ),
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'ended', true,
    'forced_by_admin', true,
    'break', to_jsonb(v_row)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_force_end_staff_break(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_force_end_staff_break(uuid) IS
  'Admin-only: force-end an active staff break after planned duration has been exceeded.';
