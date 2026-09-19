-- Daily break balances (regular + restroom) may be split across sessions.
-- Once any session of that type ends with no remaining / overtime, block further
-- starts that day. Resume leftover only from the latest positive balance so an
-- older leftover cannot bypass a later overtime session.
CREATE OR REPLACE FUNCTION public.start_staff_break(p_break_type text DEFAULT 'regular')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_type text := lower(trim(COALESCE(p_break_type, 'regular')));
  v_branch uuid;
  v_region uuid;
  v_mins integer;
  v_row public.staff_breaks%ROWTYPE;
  v_prev public.staff_breaks%ROWTYPE;
  v_today date := public.staff_break_today_ksa();
  v_busy_name text;
  v_remaining integer;
  v_exhausted_msg text;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF v_role NOT IN ('employee', 'branch_manager', 'observer') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'دورك لا يسمح ببدء بريك');
  END IF;
  IF v_type NOT IN ('regular', 'restroom') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نوع البريك غير صالح');
  END IF;

  v_exhausted_msg := CASE WHEN v_type = 'restroom'
    THEN 'خلصت مدة بريك دورة المياه اليوم'
    ELSE 'خلصت مدة بريك اليوم' END;

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

  -- Any depleted / overtime session for this type locks the rest of the day.
  IF EXISTS (
    SELECT 1
    FROM public.staff_breaks
    WHERE user_id = v_uid
      AND break_type = v_type
      AND day_key = v_today
      AND status IN ('ended', 'paused')
      AND (
        COALESCE(remaining_seconds, 0) <= 0
        OR COALESCE(overtime_seconds, 0) > 0
      )
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'exhausted', true, 'error', v_exhausted_msg
    );
  END IF;

  SELECT * INTO v_prev
  FROM public.staff_breaks
  WHERE user_id = v_uid
    AND break_type = v_type
    AND status = 'paused'
    AND day_key = v_today
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_remaining := COALESCE(v_prev.remaining_seconds, 0);
    UPDATE public.staff_breaks
    SET status = 'ended', ended_at = COALESCE(paused_at, now()),
        paused_at = NULL, updated_at = now()
    WHERE id = v_prev.id;

    IF v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'exhausted', true, 'error', v_exhausted_msg
      );
    END IF;

    INSERT INTO public.staff_breaks (
      user_id, branch_id, region_id, break_type, planned_duration_minutes,
      remaining_seconds, used_seconds, started_at, status, day_key
    ) VALUES (
      v_uid, COALESCE(v_prev.branch_id, v_branch),
      COALESCE(v_prev.region_id, v_region), v_type,
      v_prev.planned_duration_minutes, v_remaining, 0, now(), 'active', v_today
    )
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'resumed', false, 'new_session', true, 'break', to_jsonb(v_row));
  END IF;

  -- Split remaining balance across sessions: resume only the latest leftover.
  SELECT * INTO v_prev
  FROM public.staff_breaks
  WHERE user_id = v_uid
    AND break_type = v_type
    AND status = 'ended'
    AND day_key = v_today
    AND COALESCE(remaining_seconds, 0) > 0
  ORDER BY ended_at DESC NULLS LAST, updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_remaining := COALESCE(v_prev.remaining_seconds, 0);

    -- Consume this leftover once so older rows cannot be reused later.
    UPDATE public.staff_breaks
    SET remaining_seconds = 0, updated_at = now()
    WHERE id = v_prev.id;

    INSERT INTO public.staff_breaks (
      user_id, branch_id, region_id, break_type, planned_duration_minutes,
      remaining_seconds, used_seconds, started_at, status, day_key
    ) VALUES (
      v_uid, COALESCE(v_prev.branch_id, v_branch),
      COALESCE(v_prev.region_id, v_region), v_type,
      v_prev.planned_duration_minutes, v_remaining, 0, now(), 'active', v_today
    )
    RETURNING * INTO v_row;

    RETURN jsonb_build_object('ok', true, 'resumed', false, 'new_session', true, 'break', to_jsonb(v_row));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_breaks
    WHERE user_id = v_uid
      AND break_type = v_type
      AND day_key = v_today
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'exhausted', true, 'error', v_exhausted_msg
    );
  END IF;

  v_mins := public.resolve_staff_break_duration(
    v_uid, v_branch, v_region, NULL, v_type
  );

  IF v_mins IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'no_schedule_today', true,
      'error', CASE WHEN v_type = 'restroom'
        THEN 'لا يوجد بريك دورة مياه مجدول لهذا اليوم'
        ELSE 'لا يوجد بريك مجدول لهذا اليوم' END
    );
  END IF;

  INSERT INTO public.staff_breaks (
    user_id, branch_id, region_id, break_type, planned_duration_minutes,
    remaining_seconds, used_seconds, started_at, status, day_key
  ) VALUES (
    v_uid, v_branch, v_region, v_type, v_mins,
    v_mins * 60, 0, now(), 'active', v_today
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'resumed', false, 'new_session', true, 'break', to_jsonb(v_row));
END;
$function$;

REVOKE ALL ON FUNCTION public.start_staff_break(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_staff_break(text) TO authenticated;

COMMENT ON FUNCTION public.start_staff_break(text) IS
  'Starts or resumes a daily-balance break. Remaining may be split across sessions; overtime or depleted remaining blocks further starts that day.';

NOTIFY pgrst, 'reload schema';
