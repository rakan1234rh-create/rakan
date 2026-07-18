-- Staff breaks: schedules (duration by scope) + active/history sessions

CREATE TABLE IF NOT EXISTS public.staff_break_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('global', 'region', 'branch', 'user')),
  scope_id uuid NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  label text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_break_schedules_scope_chk CHECK (
    (scope_type = 'global' AND scope_id IS NULL)
    OR (scope_type <> 'global' AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_break_schedules_scope_uidx
  ON public.staff_break_schedules (scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active;

CREATE TABLE IF NOT EXISTS public.staff_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  planned_duration_minutes integer NOT NULL CHECK (planned_duration_minutes > 0 AND planned_duration_minutes <= 480),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  overtime_seconds integer NULL,
  overtime_reason text NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_breaks_ended_chk CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_breaks_one_active_per_user
  ON public.staff_breaks (user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS staff_breaks_status_started_idx
  ON public.staff_breaks (status, started_at DESC);

CREATE INDEX IF NOT EXISTS staff_breaks_branch_status_idx
  ON public.staff_breaks (branch_id, status);

-- Default global duration: 15 minutes
INSERT INTO public.staff_break_schedules (scope_type, scope_id, duration_minutes, label)
SELECT 'global', NULL, 15, 'المدة الافتراضية'
WHERE NOT EXISTS (
  SELECT 1 FROM public.staff_break_schedules WHERE scope_type = 'global' AND is_active
);

ALTER TABLE public.staff_break_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_breaks ENABLE ROW LEVEL SECURITY;

-- Resolve duration: user > branch > region > global
CREATE OR REPLACE FUNCTION public.resolve_staff_break_duration(
  p_user_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_region_id uuid DEFAULT NULL
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
  WHERE s.is_active AND s.scope_type = 'user' AND s.scope_id = v_user_id
  ORDER BY s.updated_at DESC
  LIMIT 1;
  IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;

  IF v_branch_id IS NOT NULL THEN
    SELECT s.duration_minutes INTO v_mins
    FROM public.staff_break_schedules s
    WHERE s.is_active AND s.scope_type = 'branch' AND s.scope_id = v_branch_id
    ORDER BY s.updated_at DESC
    LIMIT 1;
    IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;
  END IF;

  IF v_region_id IS NOT NULL THEN
    SELECT s.duration_minutes INTO v_mins
    FROM public.staff_break_schedules s
    WHERE s.is_active AND s.scope_type = 'region' AND s.scope_id = v_region_id
    ORDER BY s.updated_at DESC
    LIMIT 1;
    IF v_mins IS NOT NULL THEN RETURN v_mins; END IF;
  END IF;

  SELECT s.duration_minutes INTO v_mins
  FROM public.staff_break_schedules s
  WHERE s.is_active AND s.scope_type = 'global'
  ORDER BY s.updated_at DESC
  LIMIT 1;

  RETURN COALESCE(v_mins, 15);
END;
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
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  IF v_role NOT IN ('admin', 'employee', 'branch_manager', 'observer', 'supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'دورك لا يسمح ببدء بريك');
  END IF;

  IF EXISTS (SELECT 1 FROM public.staff_breaks WHERE user_id = v_uid AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لديك بريك نشط بالفعل');
  END IF;

  SELECT u.branch_id, b.region_id
    INTO v_branch, v_region
  FROM public.users u
  LEFT JOIN public.branches b ON b.id = u.branch_id
  WHERE u.id = v_uid;

  v_mins := public.resolve_staff_break_duration(v_uid, v_branch, v_region);

  INSERT INTO public.staff_breaks (
    user_id, branch_id, region_id, planned_duration_minutes, started_at, status
  ) VALUES (
    v_uid, v_branch, v_region, v_mins, now(), 'active'
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'break', to_jsonb(v_row)
  );
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
  v_overtime integer;
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
    RETURN jsonb_build_object('ok', false, 'error', 'لا يمكنك إنهاء بريك موظف آخر');
  END IF;

  v_overtime := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (now() - (v_row.started_at + make_interval(mins => v_row.planned_duration_minutes)))))::integer
  );

  IF v_overtime > 0 AND v_reason IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'needs_reason', true,
      'overtime_seconds', v_overtime,
      'error', 'تجاوزت المدة — أضف سبب التجاوز'
    );
  END IF;

  UPDATE public.staff_breaks
  SET
    status = 'ended',
    ended_at = now(),
    overtime_seconds = NULLIF(v_overtime, 0),
    overtime_reason = CASE WHEN v_overtime > 0 THEN v_reason ELSE NULL END,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'break', to_jsonb(v_row));
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

  RETURN jsonb_build_object('ok', true, 'schedule', to_jsonb(v_row));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_staff_break_duration(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_staff_break() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_staff_break(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_staff_break_schedule(text, uuid, integer, text) TO authenticated;

-- RLS: schedules readable by active users; writes via SECURITY DEFINER RPC
DROP POLICY IF EXISTS staff_break_schedules_select ON public.staff_break_schedules;
CREATE POLICY staff_break_schedules_select ON public.staff_break_schedules
  FOR SELECT TO authenticated
  USING (public.current_user_is_active());

DROP POLICY IF EXISTS staff_breaks_select ON public.staff_breaks;
CREATE POLICY staff_breaks_select ON public.staff_breaks
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      public.current_user_role() = 'admin'
      OR user_id = public.current_user_id()
      OR public.current_user_role() = 'observer'
      OR (
        public.current_user_role() = 'branch_manager'
        AND branch_id IS NOT NULL
        AND branch_id = public.current_user_branch_id()
      )
      OR (
        public.current_user_role() = 'supervisor'
        AND branch_id IS NOT NULL
        AND branch_id = ANY (public.current_user_supervised_branches())
      )
      OR (
        public.current_user_role() = 'employee'
        AND branch_id IS NOT NULL
        AND branch_id = public.current_user_branch_id()
      )
    )
  );

-- Inserts/updates go through SECURITY DEFINER RPCs; keep direct DML locked down
DROP POLICY IF EXISTS staff_breaks_insert_deny ON public.staff_breaks;
CREATE POLICY staff_breaks_insert_deny ON public.staff_breaks
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS staff_breaks_update_deny ON public.staff_breaks;
CREATE POLICY staff_breaks_update_deny ON public.staff_breaks
  FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS staff_break_schedules_write_deny ON public.staff_break_schedules;
CREATE POLICY staff_break_schedules_write_deny ON public.staff_break_schedules
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- Realtime
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
