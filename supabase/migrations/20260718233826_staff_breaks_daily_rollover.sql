-- Daily rollover: close yesterday's open breaks and scope "today" checks to KSA day_key

CREATE OR REPLACE FUNCTION public.close_stale_staff_breaks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := public.staff_break_today_ksa();
  v_count integer := 0;
BEGIN
  UPDATE public.staff_breaks sb
  SET
    status = 'ended',
    ended_at = COALESCE(sb.ended_at, now()),
    paused_at = NULL,
    remaining_seconds = CASE
      WHEN sb.status = 'active' THEN
        COALESCE(sb.remaining_seconds, sb.planned_duration_minutes * 60)
          - GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - sb.started_at)))::integer)
      ELSE COALESCE(sb.remaining_seconds, 0)
    END,
    updated_at = now()
  WHERE sb.status IN ('active', 'paused')
    AND (sb.day_key IS NULL OR sb.day_key < v_today);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

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

  IF v_role NOT IN ('admin', 'employee', 'branch_manager', 'observer', 'supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'دورك لا يسمح ببدء بريك');
  END IF;

  -- Expire open breaks from previous KSA days so each day starts fresh
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

  -- One active break per branch (today only)
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

  SELECT * INTO v_row
  FROM public.staff_breaks
  WHERE user_id = v_uid AND status = 'paused' AND day_key = v_today
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_row.remaining_seconds, 0) <= 0 THEN
      UPDATE public.staff_breaks
      SET status = 'ended', ended_at = now(), updated_at = now()
      WHERE id = v_row.id;
      RETURN jsonb_build_object('ok', false, 'error', 'خلصت مدة بريك اليوم');
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

GRANT EXECUTE ON FUNCTION public.close_stale_staff_breaks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_staff_break() TO authenticated;
