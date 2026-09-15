-- Attendance desk operators with manage_users can mark any department (like admin),
-- manage departments rows, and read all attendance records.

CREATE OR REPLACE FUNCTION public.upsert_attendance_record(
  p_user_id uuid,
  p_work_date date,
  p_status text,
  p_check_in_time time without time zone DEFAULT NULL,
  p_check_out_time time without time zone DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS public.attendance_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_target public.users%ROWTYPE;
  v_me public.users%ROWTYPE;
  v_status text := coalesce(nullif(trim(p_status), ''), 'unset');
  v_row public.attendance_records;
  v_full_desk boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_user_id IS NULL OR p_work_date IS NULL THEN
    RAISE EXCEPTION 'missing user or date';
  END IF;
  IF v_status NOT IN ('unset', 'present', 'day_off', 'off', 'sick', 'permission', 'excuse') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  SELECT * INTO v_me FROM public.users WHERE id = v_uid;

  v_full_desk := (v_role = 'admin') OR public.user_has_platform_perm('manage_users');

  IF NOT v_full_desk THEN
    -- Clerk: same department as target, or self
    IF v_target.id <> v_uid THEN
      IF v_me.department_id IS NULL OR v_target.department_id IS NULL
         OR v_me.department_id IS DISTINCT FROM v_target.department_id THEN
        RAISE EXCEPTION 'not allowed for this department';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.attendance_records AS ar (
    user_id, department_id, work_date, status,
    check_in_time, check_out_time, note, marked_by, updated_at
  ) VALUES (
    p_user_id,
    v_target.department_id,
    p_work_date,
    v_status,
    CASE WHEN v_status = 'present' THEN p_check_in_time ELSE NULL END,
    CASE WHEN v_status = 'present' THEN p_check_out_time ELSE NULL END,
    nullif(trim(coalesce(p_note, '')), ''),
    v_uid,
    now()
  )
  ON CONFLICT (user_id, work_date) DO UPDATE SET
    department_id = EXCLUDED.department_id,
    status = EXCLUDED.status,
    check_in_time = EXCLUDED.check_in_time,
    check_out_time = EXCLUDED.check_out_time,
    note = EXCLUDED.note,
    marked_by = EXCLUDED.marked_by,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

DROP POLICY IF EXISTS attendance_records_select ON public.attendance_records;
CREATE POLICY attendance_records_select
  ON public.attendance_records FOR SELECT TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      public.current_user_role() = 'admin'
      OR public.user_has_platform_perm('manage_users')
      OR marked_by = public.current_user_id()
      OR user_id = public.current_user_id()
      OR EXISTS (
        SELECT 1
        FROM public.users me
        WHERE me.id = public.current_user_id()
          AND me.department_id IS NOT NULL
          AND me.department_id = attendance_records.department_id
      )
    )
  );

DROP POLICY IF EXISTS departments_admin_write ON public.departments;
CREATE POLICY departments_admin_or_manage_users_write
  ON public.departments
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    OR public.user_has_platform_perm('manage_users')
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.user_has_platform_perm('manage_users')
  );
