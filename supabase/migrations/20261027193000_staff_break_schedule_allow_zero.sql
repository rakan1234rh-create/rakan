-- السماح بمدة 0 = إيقاف البريك لذلك اليوم/النطاق/النوع
-- (تعطيل الصف النشط دون إدخال صف بمدة صفر بسبب قيد duration_minutes > 0).

CREATE OR REPLACE FUNCTION public.upsert_staff_break_schedule(
  p_scope_type text,
  p_scope_id uuid,
  p_day_of_week smallint,
  p_duration_minutes integer,
  p_label text DEFAULT NULL,
  p_break_type text DEFAULT 'regular'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_type text := lower(trim(COALESCE(p_break_type, 'regular')));
  v_row public.staff_break_schedules%ROWTYPE;
  v_applied integer := 0;
  v_cleared integer := 0;
  v_disabled integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يعدل مدد البريك');
  END IF;
  IF p_scope_type NOT IN ('global', 'region', 'branch', 'user') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نطاق غير صالح');
  END IF;
  IF v_type NOT IN ('regular', 'restroom') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نوع البريك غير صالح');
  END IF;
  IF p_day_of_week IS NULL OR p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يوم غير صالح');
  END IF;
  -- 0 = إيقاف البريك لهذا اليوم؛ 1..480 = مدة مجدولة
  IF p_duration_minutes IS NULL OR p_duration_minutes < 0 OR p_duration_minutes > 480 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المدة يجب أن تكون بين 0 و 480 دقيقة');
  END IF;

  -- عطّل الصف الحالي لهذا النطاق/اليوم/النوع
  UPDATE public.staff_break_schedules
  SET is_active = false, updated_at = now(), updated_by = v_uid
  WHERE is_active
    AND break_type = v_type
    AND scope_type = p_scope_type
    AND day_of_week = p_day_of_week
    AND (
      (p_scope_id IS NULL AND scope_id IS NULL)
      OR scope_id = p_scope_id
    );
  GET DIAGNOSTICS v_disabled = ROW_COUNT;

  -- عند التعيين من نطاق أعلى: ألغِ التخصيصات الأدق لنفس اليوم/النوع
  IF p_scope_type = 'global' THEN
    UPDATE public.staff_break_schedules
    SET is_active = false, updated_at = now(), updated_by = v_uid
    WHERE is_active
      AND break_type = v_type
      AND day_of_week = p_day_of_week
      AND scope_type IN ('region', 'branch', 'user');
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  ELSIF p_scope_type = 'region' AND p_scope_id IS NOT NULL THEN
    UPDATE public.staff_break_schedules
    SET is_active = false, updated_at = now(), updated_by = v_uid
    WHERE is_active
      AND break_type = v_type
      AND day_of_week = p_day_of_week
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
      AND break_type = v_type
      AND day_of_week = p_day_of_week
      AND scope_type = 'user'
      AND scope_id IN (
        SELECT u.id FROM public.users u WHERE u.branch_id = p_scope_id
      );
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  -- مدة 0: أوقف اليوم دون إدراج صف (القيد يمنع duration_minutes = 0)
  IF p_duration_minutes = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'disabled', true,
      'schedule', NULL,
      'applied_sessions', 0,
      'cleared_overrides', v_cleared,
      'deactivated_rows', v_disabled
    );
  END IF;

  INSERT INTO public.staff_break_schedules (
    scope_type, scope_id, day_of_week, break_type,
    duration_minutes, label, created_by, updated_by
  ) VALUES (
    p_scope_type,
    CASE WHEN p_scope_type = 'global' THEN NULL ELSE p_scope_id END,
    p_day_of_week,
    v_type,
    p_duration_minutes,
    NULLIF(trim(COALESCE(p_label, '')), ''),
    v_uid,
    v_uid
  )
  RETURNING * INTO v_row;

  v_applied := public.apply_staff_break_duration_to_open(
    p_scope_type,
    CASE WHEN p_scope_type = 'global' THEN NULL ELSE p_scope_id END,
    p_day_of_week,
    p_duration_minutes,
    v_type
  );

  RETURN jsonb_build_object(
    'ok', true,
    'disabled', false,
    'schedule', to_jsonb(v_row),
    'applied_sessions', v_applied,
    'cleared_overrides', v_cleared
  );
END;
$function$;

COMMENT ON FUNCTION public.upsert_staff_break_schedule(text, uuid, smallint, integer, text, text) IS
  'Upsert break duration for a scope/weekday/type. duration 0 disables that day (deactivates active rows; no insert).';

GRANT EXECUTE ON FUNCTION public.upsert_staff_break_schedule(text, uuid, smallint, integer, text, text)
  TO authenticated;
