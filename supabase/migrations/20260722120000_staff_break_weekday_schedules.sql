-- Weekday-based break scheduling: each scope (global/region/branch/user) can
-- now set a different break duration per day of week (0=Sunday..6=Saturday,
-- matching EXTRACT(DOW ...) and the client's ksaWeekdayIndex()). A day with
-- no configured duration means no break is allowed that day.

ALTER TABLE public.staff_break_schedules
  ADD COLUMN IF NOT EXISTS day_of_week smallint NULL CHECK (day_of_week BETWEEN 0 AND 6);

-- Drop the old "one active row per scope" index before we mint one active
-- row per (scope, weekday) below — otherwise the clones would collide with it.
DROP INDEX IF EXISTS staff_break_schedules_scope_uidx;

-- Backfill: every currently active scope-level duration applies to every day
-- of the week (so behavior is unchanged until an admin customizes a weekday).
INSERT INTO public.staff_break_schedules (
  scope_type, scope_id, day_of_week, duration_minutes, label, is_active, created_by, updated_by
)
SELECT s.scope_type, s.scope_id, d.dow, s.duration_minutes, s.label, true, s.created_by, s.updated_by
FROM public.staff_break_schedules s
CROSS JOIN generate_series(0, 6) AS d(dow)
WHERE s.is_active AND s.day_of_week IS NULL;

UPDATE public.staff_break_schedules
SET is_active = false, updated_at = now()
WHERE is_active AND day_of_week IS NULL;

-- day_of_week stays nullable: pre-existing (already inactive) history rows
-- predate weekday scheduling and keep day_of_week = NULL forever. That's
-- harmless — every resolution query below requires `is_active AND
-- day_of_week = <weekday>`, so NULL rows (always inactive) never match.

CREATE UNIQUE INDEX IF NOT EXISTS staff_break_schedules_scope_day_uidx
  ON public.staff_break_schedules (scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), day_of_week)
  WHERE is_active;

-- Resolve duration for a given weekday: user > branch > region > global.
-- Returns NULL when nothing is scheduled for that weekday at any scope,
-- meaning no break is allowed that day.
DROP FUNCTION IF EXISTS public.resolve_staff_break_duration(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.resolve_staff_break_duration(
  p_user_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_region_id uuid DEFAULT NULL,
  p_day_of_week smallint DEFAULT NULL
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
  v_mins integer;
BEGIN
  IF v_branch_id IS NULL OR v_region_id IS NULL THEN
    SELECT u.branch_id, b.region_id
      INTO v_branch_id, v_region_id
    FROM public.users u
    LEFT JOIN public.branches b ON b.id = u.branch_id
    WHERE u.id = v_user_id;
  END IF;

  SELECT s.duration_minutes INTO v_mins
  FROM public.staff_break_schedules s
  WHERE s.is_active AND s.scope_type = 'user' AND s.scope_id = v_user_id AND s.day_of_week = v_dow
  LIMIT 1;
  IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;

  IF v_branch_id IS NOT NULL THEN
    SELECT s.duration_minutes INTO v_mins
    FROM public.staff_break_schedules s
    WHERE s.is_active AND s.scope_type = 'branch' AND s.scope_id = v_branch_id AND s.day_of_week = v_dow
    LIMIT 1;
    IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;
  END IF;

  IF v_region_id IS NOT NULL THEN
    SELECT s.duration_minutes INTO v_mins
    FROM public.staff_break_schedules s
    WHERE s.is_active AND s.scope_type = 'region' AND s.scope_id = v_region_id AND s.day_of_week = v_dow
    LIMIT 1;
    IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;
  END IF;

  SELECT s.duration_minutes INTO v_mins
  FROM public.staff_break_schedules s
  WHERE s.is_active AND s.scope_type = 'global' AND s.day_of_week = v_dow
  LIMIT 1;

  RETURN v_mins;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_staff_break_duration(uuid, uuid, uuid, smallint) TO authenticated;

-- start_staff_break: block starting a break on a day with no scheduled duration
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
        'error', 'خلصت مدة بريك اليوم'
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
      'error', 'خلصت مدة بريك اليوم'
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
      'error', 'خلصت مدة بريك اليوم'
    );
  END IF;

  v_mins := public.resolve_staff_break_duration(v_uid, v_branch, v_region);

  IF v_mins IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'no_schedule_today', true,
      'error', 'لا يوجد بريك مجدول لهذا اليوم'
    );
  END IF;

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

GRANT EXECUTE ON FUNCTION public.start_staff_break() TO authenticated;

-- apply_staff_break_duration_to_open: now scoped to a specific weekday; a
-- duration edit only touches today's open sessions when it targets today.
DROP FUNCTION IF EXISTS public.apply_staff_break_duration_to_open(text, uuid, integer);

CREATE OR REPLACE FUNCTION public.apply_staff_break_duration_to_open(
  p_scope_type text,
  p_scope_id uuid,
  p_day_of_week smallint,
  p_duration_minutes integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := public.staff_break_today_ksa();
  v_today_dow smallint := EXTRACT(DOW FROM v_today)::smallint;
  v_count integer := 0;
BEGIN
  IF p_scope_type NOT IN ('global', 'region', 'branch', 'user') THEN
    RETURN 0;
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 480 THEN
    RETURN 0;
  END IF;
  IF p_day_of_week IS DISTINCT FROM v_today_dow THEN
    RETURN 0;
  END IF;

  WITH scoped AS (
    SELECT sb.*
    FROM public.staff_breaks sb
    LEFT JOIN public.branches b ON b.id = sb.branch_id
    WHERE sb.day_key = v_today
      AND sb.status IN ('active', 'paused', 'ended')
      AND (
        (p_scope_type = 'global')
        OR (p_scope_type = 'user' AND sb.user_id = p_scope_id)
        OR (p_scope_type = 'branch' AND sb.branch_id = p_scope_id)
        OR (
          p_scope_type = 'region'
          AND (
            sb.region_id = p_scope_id
            OR b.region_id = p_scope_id
          )
        )
      )
  ),
  ranked AS (
    SELECT
      s.*,
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
    SELECT
      p.id,
      p.status,
      p.ended_at,
      p.paused_at,
      p.started_at,
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

GRANT EXECUTE ON FUNCTION public.apply_staff_break_duration_to_open(text, uuid, smallint, integer) TO authenticated;

-- upsert_staff_break_schedule: admin sets duration per scope AND weekday.
-- Cascades clear nested-scope overrides for the same weekday only.
DROP FUNCTION IF EXISTS public.upsert_staff_break_schedule(text, uuid, integer, text);

CREATE OR REPLACE FUNCTION public.upsert_staff_break_schedule(
  p_scope_type text,
  p_scope_id uuid,
  p_day_of_week smallint,
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

  IF p_day_of_week IS NULL OR p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يوم غير صالح');
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 480 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المدة يجب أن تكون بين 1 و 480 دقيقة');
  END IF;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يعدل مدد البريك');
  END IF;

  -- Same-scope-and-day replace
  UPDATE public.staff_break_schedules
  SET is_active = false, updated_at = now(), updated_by = v_uid
  WHERE is_active
    AND scope_type = p_scope_type
    AND day_of_week = p_day_of_week
    AND (
      (p_scope_id IS NULL AND scope_id IS NULL)
      OR scope_id = p_scope_id
    );

  -- Clear nested overrides for the same weekday so the new duration wins for employees
  IF p_scope_type = 'global' THEN
    UPDATE public.staff_break_schedules
    SET is_active = false, updated_at = now(), updated_by = v_uid
    WHERE is_active
      AND day_of_week = p_day_of_week
      AND scope_type IN ('region', 'branch', 'user');
    GET DIAGNOSTICS v_cleared = ROW_COUNT;

  ELSIF p_scope_type = 'region' AND p_scope_id IS NOT NULL THEN
    UPDATE public.staff_break_schedules
    SET is_active = false, updated_at = now(), updated_by = v_uid
    WHERE is_active
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
      AND day_of_week = p_day_of_week
      AND scope_type = 'user'
      AND scope_id IN (
        SELECT u.id FROM public.users u WHERE u.branch_id = p_scope_id
      );
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  INSERT INTO public.staff_break_schedules (
    scope_type, scope_id, day_of_week, duration_minutes, label, created_by, updated_by
  ) VALUES (
    p_scope_type,
    CASE WHEN p_scope_type = 'global' THEN NULL ELSE p_scope_id END,
    p_day_of_week,
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

COMMENT ON FUNCTION public.upsert_staff_break_schedule(text, uuid, smallint, integer, text) IS
  'Upsert break schedule duration by scope + weekday (admin only). Clears same-weekday nested overrides so employees pick up the new minutes immediately.';

GRANT EXECUTE ON FUNCTION public.upsert_staff_break_schedule(text, uuid, smallint, integer, text) TO authenticated;
