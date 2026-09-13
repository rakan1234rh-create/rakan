-- المعارض = branch staff on the platform: أخصائي مبيعات / مشرف / مدير فرع

UPDATE public.users u
SET department_id = d.id
FROM public.departments d
WHERE d.slug = 'galleries'
  AND u.is_active IS DISTINCT FROM false
  AND u.role::text IN ('employee', 'supervisor', 'branch_manager')
  AND (u.department_id IS NULL OR u.department_id IS DISTINCT FROM d.id);

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
  v_dept_id uuid;
  v_galleries_id uuid;
  v_row public.attendance_records;
  v_target_role text;
  v_me_role text;
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
  v_target_role := lower(coalesce(v_target.role::text, ''));
  v_me_role := lower(coalesce(v_me.role::text, ''));

  SELECT id INTO v_galleries_id FROM public.departments WHERE slug = 'galleries' LIMIT 1;

  -- Resolve department: explicit assignment, else galleries for branch staff roles
  v_dept_id := v_target.department_id;
  IF v_dept_id IS NULL
     AND v_galleries_id IS NOT NULL
     AND v_target_role IN ('employee', 'supervisor', 'branch_manager') THEN
    v_dept_id := v_galleries_id;
    UPDATE public.users SET department_id = v_galleries_id WHERE id = v_target.id AND department_id IS NULL;
  END IF;

  IF v_role IS DISTINCT FROM 'admin' THEN
    IF v_target.id <> v_uid THEN
      IF v_me.department_id IS NOT NULL AND v_dept_id IS NOT NULL AND v_me.department_id = v_dept_id THEN
        NULL; -- same department
      ELSIF v_galleries_id IS NOT NULL
            AND v_dept_id = v_galleries_id
            AND v_me_role IN ('employee', 'supervisor', 'branch_manager') THEN
        NULL; -- galleries branch-staff clerk
      ELSE
        RAISE EXCEPTION 'not allowed for this department';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.attendance_records AS ar (
    user_id, department_id, work_date, status,
    check_in_time, check_out_time, note, marked_by, updated_at
  ) VALUES (
    p_user_id,
    v_dept_id,
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

GRANT EXECUTE ON FUNCTION public.upsert_attendance_record(uuid, date, text, time, time, text)
  TO authenticated;
