-- Departments + daily attendance (desktop attendance desk)

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.departments (name, slug, sort_order)
SELECT v.name, v.slug, v.sort_order
FROM (VALUES
  ('المعارض', 'galleries', 10),
  ('الإدارة', 'admin', 20),
  ('التعبئة', 'packing', 30)
) AS v(name, slug, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments d WHERE d.slug = v.slug
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_department_id_idx
  ON public.users (department_id)
  WHERE department_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  work_date date NOT NULL,
  status text NOT NULL DEFAULT 'unset'
    CHECK (status IN ('unset', 'present', 'day_off', 'off', 'sick', 'permission', 'excuse')),
  check_in_time time without time zone NULL,
  check_out_time time without time zone NULL,
  note text NULL,
  marked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_records_user_date_uidx UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS attendance_records_date_dept_idx
  ON public.attendance_records (work_date, department_id);

CREATE INDEX IF NOT EXISTS attendance_records_user_date_idx
  ON public.attendance_records (user_id, work_date DESC);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS departments_select_authenticated ON public.departments;
CREATE POLICY departments_select_authenticated
  ON public.departments FOR SELECT TO authenticated
  USING (public.current_user_is_active());

DROP POLICY IF EXISTS departments_admin_write ON public.departments;
CREATE POLICY departments_admin_write
  ON public.departments FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS attendance_records_select ON public.attendance_records;
CREATE POLICY attendance_records_select
  ON public.attendance_records FOR SELECT TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      public.current_user_role() = 'admin'
      OR marked_by = public.current_user_id()
      OR user_id = public.current_user_id()
      OR EXISTS (
        SELECT 1 FROM public.users me
        WHERE me.id = public.current_user_id()
          AND me.department_id IS NOT NULL
          AND me.department_id = attendance_records.department_id
      )
    )
  );

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

  IF v_role IS DISTINCT FROM 'admin' THEN
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

GRANT EXECUTE ON FUNCTION public.upsert_attendance_record(uuid, date, text, time, time, text)
  TO authenticated;
