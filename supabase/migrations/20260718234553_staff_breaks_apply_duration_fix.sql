-- Fix: never reopen an ended break if the user already has an open session today

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
