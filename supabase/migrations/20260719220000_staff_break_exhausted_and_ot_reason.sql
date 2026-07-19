-- 1) After today's break allowance is used up (ended/paused with remaining <= 0),
--    do not allow starting a fresh break. Admin duration top-up reopens as paused
--    with remaining > 0 via apply_staff_break_duration_to_open, which can resume.
-- 2) Overtime reason is required only after exceeding by 5+ minutes.

CREATE OR REPLACE FUNCTION public.start_staff_break()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_branch uuid;
  v_region uuid;
  v_mins integer;
  v_row public.staff_breaks%ROWTYPE;
  v_today date := public.staff_break_today_ksa();
  v_busy_name text;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  IF v_role NOT IN ('employee', 'branch_manager', 'observer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'دورك لا يسمح ببدء بريك');
  END IF;

  PERFORM public.close_stale_staff_breaks();

  SELECT * INTO v_row
  FROM public.staff_breaks
  WHERE user_id = v_uid AND status = 'active' AND day_key = v_today
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لديك بريك نشط بالفعل', 'break', to_jsonb(v_row));
  END IF;

  SELECT u.branch_id, b.region_id
    INTO v_branch, v_region
  FROM public.users u
  LEFT JOIN public.branches b ON b.id = u.branch_id
  WHERE u.id = v_uid;

  IF v_branch IS NOT NULL THEN
    SELECT u.name INTO v_busy_name
    FROM public.staff_breaks sb
    JOIN public.users u ON u.id = sb.user_id
    WHERE sb.branch_id = v_branch
      AND sb.status = 'active'
      AND sb.day_key = v_today
      AND sb.user_id <> v_uid
    ORDER BY sb.started_at DESC
    LIMIT 1;

    IF v_busy_name IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'branch_busy', true,
        'busy_name', v_busy_name,
        'error', 'يوجد زميل في بريك حالياً (' || v_busy_name || ') — انتظر حتى يعود'
      );
    END IF;
  END IF;

  -- Resume paused break with remaining time
  SELECT * INTO v_row
  FROM public.staff_breaks
  WHERE user_id = v_uid AND status = 'paused' AND day_key = v_today
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_row.remaining_seconds, 0) <= 0 THEN
      UPDATE public.staff_breaks
      SET status = 'ended', ended_at = COALESCE(ended_at, now()), updated_at = now()
      WHERE id = v_row.id;
      RETURN jsonb_build_object(
        'ok', false,
        'exhausted', true,
        'error', 'خلصت مدة بريك اليوم — اطلب من مدير النظام زيادة المدة إن لزم'
      );
    END IF;

    UPDATE public.staff_breaks
    SET
      status = 'active',
      started_at = now(),
      paused_at = NULL,
      updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'resumed', true, 'break', to_jsonb(v_row));
  END IF;

  -- Admin top-up may leave ended + remaining > 0; allow resume
  SELECT * INTO v_row
  FROM public.staff_breaks
  WHERE user_id = v_uid
    AND status = 'ended'
    AND day_key = v_today
    AND COALESCE(remaining_seconds, 0) > 0
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.staff_breaks
    SET
      status = 'active',
      started_at = now(),
      paused_at = NULL,
      ended_at = NULL,
      updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'resumed', true, 'break', to_jsonb(v_row));
  END IF;

  -- Already used today's allowance (ended with no remaining) → no fresh break
  IF EXISTS (
    SELECT 1
    FROM public.staff_breaks
    WHERE user_id = v_uid
      AND day_key = v_today
      AND status = 'ended'
      AND COALESCE(remaining_seconds, 0) <= 0
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'exhausted', true,
      'error', 'خلصت مدة بريك اليوم — اطلب من مدير النظام زيادة المدة إن لزم'
    );
  END IF;

  -- Any other session today already exists → do not mint a second full allowance
  IF EXISTS (
    SELECT 1
    FROM public.staff_breaks
    WHERE user_id = v_uid
      AND day_key = v_today
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'exhausted', true,
      'error', 'خلصت مدة بريك اليوم — اطلب من مدير النظام زيادة المدة إن لزم'
    );
  END IF;

  v_mins := public.resolve_staff_break_duration(v_uid, v_branch, v_region);

  INSERT INTO public.staff_breaks (
    user_id, branch_id, region_id, planned_duration_minutes,
    remaining_seconds, used_seconds, started_at, status, day_key
  ) VALUES (
    v_uid, v_branch, v_region, v_mins,
    v_mins * 60, 0, now(), 'active', v_today
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'resumed', false, 'break', to_jsonb(v_row));
END;
$function$;

CREATE OR REPLACE FUNCTION public.end_staff_break(
  p_break_id uuid,
  p_overtime_reason text DEFAULT NULL
)
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
  v_reason text := NULLIF(trim(COALESCE(p_overtime_reason, '')), '');
  v_reason_after integer := 300; -- 5 minutes
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  SELECT * INTO v_row
  FROM public.staff_breaks
  WHERE id = p_break_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يوجد بريك نشط');
  END IF;

  IF v_row.user_id <> v_uid AND public.current_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يمكنك إيقاف بريك موظف آخر');
  END IF;

  v_elapsed := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - v_row.started_at)))::integer);
  v_remaining := COALESCE(v_row.remaining_seconds, v_row.planned_duration_minutes * 60) - v_elapsed;

  -- Reason only after exceeding by 5+ minutes
  IF v_remaining < -v_reason_after AND v_reason IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'needs_reason', true,
      'overtime_seconds', ABS(v_remaining),
      'error', 'تجاوزت المدة بأكثر من 5 دقائق — أضف سبب التجاوز'
    );
  END IF;

  IF v_remaining <= 0 THEN
    UPDATE public.staff_breaks
    SET
      status = 'ended',
      ended_at = now(),
      paused_at = NULL,
      remaining_seconds = v_remaining,
      used_seconds = COALESCE(used_seconds, 0) + v_elapsed,
      overtime_seconds = CASE WHEN v_remaining < 0 THEN ABS(v_remaining) ELSE NULL END,
      overtime_reason = CASE
        WHEN v_remaining < -v_reason_after THEN v_reason
        ELSE NULL
      END,
      updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'paused', false, 'ended', true, 'break', to_jsonb(v_row));
  END IF;

  UPDATE public.staff_breaks
  SET
    status = 'paused',
    paused_at = now(),
    remaining_seconds = v_remaining,
    used_seconds = COALESCE(used_seconds, 0) + v_elapsed,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'paused', true, 'ended', false, 'break', to_jsonb(v_row));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.start_staff_break() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_staff_break(uuid, text) TO authenticated;
