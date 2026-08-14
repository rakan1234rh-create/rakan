-- When break duration schedules change, apply immediately to today's sessions
-- and enable realtime so employees see the new minutes without refresh.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_breaks;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_break_schedules;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.apply_staff_break_duration_to_open(
  p_scope_type text,
  p_scope_id uuid,
  p_duration_minutes integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := public.staff_break_today_ksa();
  v_count integer := 0;
BEGIN
  IF p_scope_type NOT IN ('global', 'region', 'branch', 'user') THEN
    RETURN 0;
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 480 THEN
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
    -- Reset active segment so remaining_seconds is the live balance
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
  v_branch_region uuid;
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

  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'supervisor' THEN
    IF p_scope_type = 'global' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يضبط المدة العامة');
    ELSIF p_scope_type = 'region' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.regions r
        WHERE r.id = p_scope_id AND r.supervisor_id = v_uid
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ليست ضمن مناطقك');
      END IF;
    ELSIF p_scope_type = 'branch' THEN
      IF NOT (p_scope_id = ANY (public.current_user_supervised_branches())) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ليست ضمن فروعك');
      END IF;
    ELSIF p_scope_type = 'user' THEN
      SELECT b.region_id INTO v_branch_region
      FROM public.users u
      JOIN public.branches b ON b.id = u.branch_id
      WHERE u.id = p_scope_id;
      IF v_branch_region IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.regions r
        WHERE r.id = v_branch_region AND r.supervisor_id = v_uid
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'الموظف ليس ضمن منطقتك');
      END IF;
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'لا تملك صلاحية تعديل مدد البريك');
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

GRANT EXECUTE ON FUNCTION public.apply_staff_break_duration_to_open(text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_staff_break_schedule(text, uuid, integer, text) TO authenticated;
