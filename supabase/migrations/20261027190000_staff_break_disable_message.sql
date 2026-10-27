-- رسالة اختيارية تظهر للموظفين عندما لا يوجد بريك مجدول لليوم.
-- قيم افتراضية آمنة: الخيار مغلق والرسالة فارغة.

CREATE TABLE IF NOT EXISTS public.staff_break_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  disable_message_enabled boolean NOT NULL DEFAULT false,
  disable_message text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL
);

INSERT INTO public.staff_break_settings (id, disable_message_enabled, disable_message)
VALUES (1, false, '')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.staff_break_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_break_settings_select ON public.staff_break_settings;
CREATE POLICY staff_break_settings_select ON public.staff_break_settings
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

DROP POLICY IF EXISTS staff_break_settings_write_deny ON public.staff_break_settings;
CREATE POLICY staff_break_settings_write_deny ON public.staff_break_settings
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.staff_break_settings IS
  'إعدادات عامة للبريكات (صف واحد). رسالة الإيقاف اختيارية عند غياب جدول اليوم.';

CREATE OR REPLACE FUNCTION public.get_staff_break_disable_message()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enabled boolean := false;
  v_message text := '';
BEGIN
  IF public.current_user_id() IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'يجب تسجيل الدخول',
      'enabled', false,
      'message', ''
    );
  END IF;

  SELECT s.disable_message_enabled, COALESCE(s.disable_message, '')
    INTO v_enabled, v_message
  FROM public.staff_break_settings s
  WHERE s.id = 1;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', COALESCE(v_enabled, false),
    'message', COALESCE(v_message, '')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_break_active_disable_message()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_enabled boolean := false;
  v_message text := '';
BEGIN
  SELECT s.disable_message_enabled, trim(COALESCE(s.disable_message, ''))
    INTO v_enabled, v_message
  FROM public.staff_break_settings s
  WHERE s.id = 1;

  IF COALESCE(v_enabled, false) IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF v_message IS NULL OR length(v_message) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN left(v_message, 500);
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_staff_break_disable_message(
  p_enabled boolean DEFAULT false,
  p_message text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_msg text := left(trim(COALESCE(p_message, '')), 500);
  v_enabled boolean := COALESCE(p_enabled, false);
  v_row public.staff_break_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يعدّل رسالة إيقاف البريكات');
  END IF;

  IF v_enabled AND length(v_msg) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'أدخل نص الرسالة قبل تفعيل الخيار'
    );
  END IF;

  INSERT INTO public.staff_break_settings (id, disable_message_enabled, disable_message, updated_by, updated_at)
  VALUES (1, v_enabled, v_msg, v_uid, now())
  ON CONFLICT (id) DO UPDATE
    SET disable_message_enabled = EXCLUDED.disable_message_enabled,
        disable_message = EXCLUDED.disable_message,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', v_row.disable_message_enabled,
    'message', v_row.disable_message
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_staff_break_disable_message() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_break_active_disable_message() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_staff_break_disable_message(boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_staff_break_disable_message(boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_staff_break_disable_message() FROM anon;
REVOKE ALL ON FUNCTION public.staff_break_active_disable_message() FROM anon;

-- عند محاولة البدء ويوم بدون جدول: أرفق الرسالة المفعّلة إن وُجدت.
CREATE OR REPLACE FUNCTION public.start_staff_break(p_break_type text DEFAULT 'regular'::text)
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
  v_disable_msg text;
  v_default_off text;
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
    v_disable_msg := public.staff_break_active_disable_message();
    v_default_off := CASE WHEN v_type = 'restroom'
      THEN 'لا يوجد بريك دورة مياه مجدول لهذا اليوم'
      ELSE 'لا يوجد بريك مجدول لهذا اليوم' END;
    RETURN jsonb_build_object(
      'ok', false,
      'no_schedule_today', true,
      'disable_message', v_disable_msg,
      'error', CASE
        WHEN v_disable_msg IS NOT NULL AND length(v_disable_msg) > 0 THEN v_disable_msg
        ELSE v_default_off
      END
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
