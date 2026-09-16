-- Separate regular and restroom breaks, each with its own weekday schedule.
-- Existing rows remain regular breaks. Only one active break per user/branch
-- is still allowed by the existing partial unique indexes and start RPC.

ALTER TABLE public.staff_break_schedules
  ADD COLUMN IF NOT EXISTS break_type text NOT NULL DEFAULT 'regular';

ALTER TABLE public.staff_breaks
  ADD COLUMN IF NOT EXISTS break_type text NOT NULL DEFAULT 'regular';

ALTER TABLE public.staff_break_schedules
  DROP CONSTRAINT IF EXISTS staff_break_schedules_break_type_chk;
ALTER TABLE public.staff_break_schedules
  ADD CONSTRAINT staff_break_schedules_break_type_chk
  CHECK (break_type IN ('regular', 'restroom'));

ALTER TABLE public.staff_breaks
  DROP CONSTRAINT IF EXISTS staff_breaks_break_type_chk;
ALTER TABLE public.staff_breaks
  ADD CONSTRAINT staff_breaks_break_type_chk
  CHECK (break_type IN ('regular', 'restroom'));

DROP INDEX IF EXISTS staff_break_schedules_scope_day_uidx;
DROP INDEX IF EXISTS staff_break_schedules_scope_day_type_uidx;
CREATE UNIQUE INDEX staff_break_schedules_scope_day_type_uidx
  ON public.staff_break_schedules (
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    day_of_week,
    break_type
  )
  WHERE is_active;

CREATE INDEX IF NOT EXISTS staff_breaks_user_day_type_idx
  ON public.staff_breaks (user_id, day_key, break_type, status, updated_at DESC);

-- Default restroom allowance: 10 minutes for every weekday. Admin can
-- override it by region, branch, employee, and weekday from the same editor.
INSERT INTO public.staff_break_schedules (
  scope_type, scope_id, day_of_week, break_type, duration_minutes, label, is_active
)
SELECT 'global', NULL, d.dow, 'restroom', 10, 'بريك دورة مياه', true
FROM generate_series(0, 6) AS d(dow)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.staff_break_schedules s
  WHERE s.is_active
    AND s.scope_type = 'global'
    AND s.scope_id IS NULL
    AND s.day_of_week = d.dow
    AND s.break_type = 'restroom'
);

DROP FUNCTION IF EXISTS public.resolve_staff_break_duration(uuid, uuid, uuid, smallint);
CREATE OR REPLACE FUNCTION public.resolve_staff_break_duration(
  p_user_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_region_id uuid DEFAULT NULL,
  p_day_of_week smallint DEFAULT NULL,
  p_break_type text DEFAULT 'regular'
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, public.current_user_id());
  v_branch_id uuid := p_branch_id;
  v_region_id uuid := p_region_id;
  v_dow smallint := COALESCE(p_day_of_week, EXTRACT(DOW FROM public.staff_break_today_ksa())::smallint);
  v_type text := lower(trim(COALESCE(p_break_type, 'regular')));
  v_mins integer;
BEGIN
  IF v_type NOT IN ('regular', 'restroom') THEN
    RETURN NULL;
  END IF;

  IF v_branch_id IS NULL OR v_region_id IS NULL THEN
    SELECT u.branch_id, b.region_id
      INTO v_branch_id, v_region_id
    FROM public.users u
    LEFT JOIN public.branches b ON b.id = u.branch_id
    WHERE u.id = v_user_id;
  END IF;

  SELECT s.duration_minutes INTO v_mins
  FROM public.staff_break_schedules s
  WHERE s.is_active
    AND s.break_type = v_type
    AND s.scope_type = 'user'
    AND s.scope_id = v_user_id
    AND s.day_of_week = v_dow
  LIMIT 1;
  IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;

  IF v_branch_id IS NOT NULL THEN
    SELECT s.duration_minutes INTO v_mins
    FROM public.staff_break_schedules s
    WHERE s.is_active
      AND s.break_type = v_type
      AND s.scope_type = 'branch'
      AND s.scope_id = v_branch_id
      AND s.day_of_week = v_dow
    LIMIT 1;
    IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;
  END IF;

  IF v_region_id IS NOT NULL THEN
    SELECT s.duration_minutes INTO v_mins
    FROM public.staff_break_schedules s
    WHERE s.is_active
      AND s.break_type = v_type
      AND s.scope_type = 'region'
      AND s.scope_id = v_region_id
      AND s.day_of_week = v_dow
    LIMIT 1;
    IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;
  END IF;

  SELECT s.duration_minutes INTO v_mins
  FROM public.staff_break_schedules s
  WHERE s.is_active
    AND s.break_type = v_type
    AND s.scope_type = 'global'
    AND s.day_of_week = v_dow
  LIMIT 1;

  RETURN v_mins;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_staff_break_duration(uuid, uuid, uuid, smallint, text)
  TO authenticated;

DROP FUNCTION IF EXISTS public.apply_staff_break_duration_to_open(text, uuid, smallint, integer);
CREATE OR REPLACE FUNCTION public.apply_staff_break_duration_to_open(
  p_scope_type text,
  p_scope_id uuid,
  p_day_of_week smallint,
  p_duration_minutes integer,
  p_break_type text DEFAULT 'regular'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := public.staff_break_today_ksa();
  v_today_dow smallint := EXTRACT(DOW FROM v_today)::smallint;
  v_type text := lower(trim(COALESCE(p_break_type, 'regular')));
  v_count integer := 0;
BEGIN
  IF p_scope_type NOT IN ('global', 'region', 'branch', 'user')
    OR v_type NOT IN ('regular', 'restroom')
    OR p_duration_minutes IS NULL
    OR p_duration_minutes < 1
    OR p_duration_minutes > 480
    OR p_day_of_week IS DISTINCT FROM v_today_dow
  THEN
    RETURN 0;
  END IF;

  WITH scoped AS (
    SELECT sb.*
    FROM public.staff_breaks sb
    LEFT JOIN public.branches b ON b.id = sb.branch_id
    WHERE sb.day_key = v_today
      AND sb.break_type = v_type
      AND sb.status IN ('active', 'paused', 'ended')
      AND (
        p_scope_type = 'global'
        OR (p_scope_type = 'user' AND sb.user_id = p_scope_id)
        OR (p_scope_type = 'branch' AND sb.branch_id = p_scope_id)
        OR (
          p_scope_type = 'region'
          AND (sb.region_id = p_scope_id OR b.region_id = p_scope_id)
        )
      )
  ),
  ranked AS (
    SELECT s.*,
      ROW_NUMBER() OVER (
        PARTITION BY s.user_id
        ORDER BY
          CASE s.status WHEN 'active' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
          s.updated_at DESC NULLS LAST,
          s.started_at DESC NULLS LAST
      ) AS rn
    FROM scoped s
  ),
  primary_row AS (
    SELECT * FROM ranked WHERE rn = 1
  ),
  computed AS (
    SELECT p.id, p.status, p.ended_at, p.paused_at, p.started_at,
      (p_duration_minutes * 60) - GREATEST(
        0,
        (COALESCE(p.planned_duration_minutes, p_duration_minutes) * 60)
          - COALESCE(
              p.remaining_seconds,
              COALESCE(p.planned_duration_minutes, p_duration_minutes) * 60
            )
          + CASE
              WHEN p.status = 'active' THEN
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - p.started_at)))::integer)
              ELSE 0
            END
      ) AS new_remaining
    FROM primary_row p
  )
  UPDATE public.staff_breaks sb
  SET
    planned_duration_minutes = p_duration_minutes,
    remaining_seconds = c.new_remaining,
    status = CASE
      WHEN c.status = 'ended' AND c.new_remaining > 0 THEN 'paused'
      WHEN c.status = 'paused' AND c.new_remaining <= 0 THEN 'ended'
      ELSE c.status
    END,
    ended_at = CASE
      WHEN c.status = 'ended' AND c.new_remaining > 0 THEN NULL
      WHEN c.status = 'paused' AND c.new_remaining <= 0 THEN COALESCE(c.ended_at, now())
      ELSE c.ended_at
    END,
    paused_at = CASE
      WHEN c.status = 'ended' AND c.new_remaining > 0 THEN now()
      WHEN c.status = 'paused' AND c.new_remaining <= 0 THEN NULL
      ELSE c.paused_at
    END,
    started_at = CASE WHEN c.status = 'active' THEN now() ELSE c.started_at END,
    updated_at = now()
  FROM computed c
  WHERE sb.id = c.id
    AND (
      sb.planned_duration_minutes IS DISTINCT FROM p_duration_minutes
      OR sb.remaining_seconds IS DISTINCT FROM c.new_remaining
      OR (c.status = 'ended' AND c.new_remaining > 0)
      OR (c.status = 'paused' AND c.new_remaining <= 0)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_staff_break_duration_to_open(text, uuid, smallint, integer, text)
  TO authenticated;

DROP FUNCTION IF EXISTS public.upsert_staff_break_schedule(text, uuid, smallint, integer, text);
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
  IF p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 480 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المدة يجب أن تكون بين 1 و 480 دقيقة');
  END IF;

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
    'schedule', to_jsonb(v_row),
    'applied_sessions', v_applied,
    'cleared_overrides', v_cleared
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.upsert_staff_break_schedule(text, uuid, smallint, integer, text, text)
  TO authenticated;

DROP FUNCTION IF EXISTS public.start_staff_break();
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
        'ok', false, 'exhausted', true,
        'error', CASE WHEN v_type = 'restroom'
          THEN 'خلصت مدة بريك دورة المياه اليوم'
          ELSE 'خلصت مدة بريك اليوم' END
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
      AND status = 'ended'
      AND COALESCE(remaining_seconds, 0) <= 0
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'exhausted', true,
      'error', CASE WHEN v_type = 'restroom'
        THEN 'خلصت مدة بريك دورة المياه اليوم'
        ELSE 'خلصت مدة بريك اليوم' END
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_breaks
    WHERE user_id = v_uid
      AND break_type = v_type
      AND day_key = v_today
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'exhausted', true,
      'error', CASE WHEN v_type = 'restroom'
        THEN 'خلصت مدة بريك دورة المياه اليوم'
        ELSE 'خلصت مدة بريك اليوم' END
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

GRANT EXECUTE ON FUNCTION public.start_staff_break(text) TO authenticated;

COMMENT ON COLUMN public.staff_breaks.break_type IS
  'regular = scheduled normal break; restroom = separately scheduled restroom allowance.';
COMMENT ON COLUMN public.staff_break_schedules.break_type IS
  'Schedule category: regular or restroom.';
COMMENT ON FUNCTION public.start_staff_break(text) IS
  'Starts a regular or restroom break. Each type has an independent daily allowance.';

NOTIFY pgrst, 'reload schema';
