-- Fix false "exhausted" after short multi-session breaks:
-- leftover consume zeros older remaining_seconds; only the LATEST closed
-- session of that type should decide if the day is locked.
-- Also fix admin overtime_reason encoding via unicode escapes + optional client reason.

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
  v_latest public.staff_breaks%ROWTYPE;
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

  IF EXISTS (
    SELECT 1
    FROM public.staff_breaks
    WHERE status IN ('active', 'paused')
      AND (day_key IS NULL OR day_key < v_today)
    LIMIT 1
  ) THEN
    PERFORM public.close_stale_staff_breaks();
  END IF;

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

  -- Only the latest closed session locks the day (ignore older leftover=0 markers).
  SELECT * INTO v_latest
  FROM public.staff_breaks
  WHERE user_id = v_uid
    AND break_type = v_type
    AND day_key = v_today
    AND status IN ('ended', 'paused')
  ORDER BY COALESCE(ended_at, paused_at, updated_at) DESC NULLS LAST, started_at DESC
  LIMIT 1;

  IF FOUND AND (
    COALESCE(v_latest.remaining_seconds, 0) <= 0
    OR COALESCE(v_latest.overtime_seconds, 0) > 0
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

-- Prefer reason from client (UTF-8 JSON) to avoid migration encoding issues.
CREATE OR REPLACE FUNCTION public.admin_force_end_staff_break(
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

  IF v_reason IS NULL THEN
    -- U& escape keeps Arabic intact regardless of client code page
    v_reason := U&'\0625\064A\0642\0627\0641 \0625\062F\0627\0631\064A \0645\0646 \0645\062F\064A\0631 \0627\0644\0646\0638\0627\0645';
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
      v_reason
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

DROP FUNCTION IF EXISTS public.admin_force_end_staff_break(uuid);
-- Recreate single-arg wrapper for older clients
CREATE OR REPLACE FUNCTION public.admin_force_end_staff_break(p_break_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.admin_force_end_staff_break(p_break_id, NULL);
$$;

REVOKE ALL ON FUNCTION public.admin_force_end_staff_break(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_force_end_staff_break(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_end_staff_break(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_end_staff_break(uuid, text) TO authenticated;

-- Repair known mojibake admin reasons already stored
UPDATE public.staff_breaks
SET overtime_reason = U&'\0625\064A\0642\0627\0641 \0625\062F\0627\0631\064A \0645\0646 \0645\062F\064A\0631 \0627\0644\0646\0638\0627\0645',
    updated_at = now()
WHERE overtime_reason IS NOT NULL
  AND overtime_reason !~ U&'[\0600-\06FF]'
  AND position(U&'\00D8' in overtime_reason) > 0;

NOTIFY pgrst, 'reload schema';
