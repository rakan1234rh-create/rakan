-- Pause/resume: remaining_seconds carries across stop/start

ALTER TABLE public.staff_breaks
  DROP CONSTRAINT IF EXISTS staff_breaks_ended_chk;

ALTER TABLE public.staff_breaks
  DROP CONSTRAINT IF EXISTS staff_breaks_status_check;

ALTER TABLE public.staff_breaks
  ADD COLUMN IF NOT EXISTS remaining_seconds integer,
  ADD COLUMN IF NOT EXISTS used_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS day_key date;

UPDATE public.staff_breaks
SET remaining_seconds = GREATEST(
  0,
  (planned_duration_minutes * 60)
  - GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)))::integer)
)
WHERE remaining_seconds IS NULL;

UPDATE public.staff_breaks
SET day_key = (started_at AT TIME ZONE 'Asia/Riyadh')::date
WHERE day_key IS NULL;

ALTER TABLE public.staff_breaks
  ALTER COLUMN remaining_seconds SET DEFAULT 0;

ALTER TABLE public.staff_breaks
  ADD CONSTRAINT staff_breaks_status_check
  CHECK (status IN ('active', 'paused', 'ended'));

ALTER TABLE public.staff_breaks
  ADD CONSTRAINT staff_breaks_ended_chk CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'paused' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  );

DROP INDEX IF EXISTS staff_breaks_one_active_per_user;
CREATE UNIQUE INDEX staff_breaks_one_open_per_user
  ON public.staff_breaks (user_id)
  WHERE status IN ('active', 'paused');

CREATE OR REPLACE FUNCTION public.staff_break_today_ksa()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date;
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
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  IF v_role NOT IN ('admin', 'employee', 'branch_manager', 'observer', 'supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'دورك لا يسمح ببدء بريك');
  END IF;

  SELECT * INTO v_row
  FROM public.staff_breaks
  WHERE user_id = v_uid AND status = 'active'
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لديك بريك نشط بالفعل', 'break', to_jsonb(v_row));
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

  SELECT u.branch_id, b.region_id
    INTO v_branch, v_region
  FROM public.users u
  LEFT JOIN public.branches b ON b.id = u.branch_id
  WHERE u.id = v_uid;

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

  IF v_remaining < 0 AND v_reason IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'needs_reason', true,
      'overtime_seconds', ABS(v_remaining),
      'error', 'تجاوزت المدة — أضف سبب التجاوز'
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
      overtime_reason = CASE WHEN v_remaining < 0 THEN v_reason ELSE NULL END,
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

GRANT EXECUTE ON FUNCTION public.staff_break_today_ksa() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_staff_break() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_staff_break(uuid, text) TO authenticated;
