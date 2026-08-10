-- Complaints & Suggestions (الشكاوى والاقتراحات): employee self-service
-- channel to submit a complaint or suggestion, track status, and hold a
-- reply thread with management. Mirrors the `violations` ticket system's
-- append-only jsonb `logs` thread pattern, but kept single-stage
-- (pending/resolved) with hard admin-only management — complaints can be
-- about a supervisor, so only admin gets full visibility/reply/resolve,
-- everyone else sees only their own.

CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_number text UNIQUE,
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('complaint', 'suggestion')),
  category text NOT NULL CHECK (char_length(btrim(category)) > 0),
  description text NOT NULL CHECK (char_length(btrim(description)) > 0),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  logs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(logs) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX complaints_employee_idx ON public.complaints (employee_id);
CREATE INDEX complaints_status_idx ON public.complaints (status);
CREATE INDEX complaints_created_idx ON public.complaints (created_at DESC);

CREATE SEQUENCE public.complaints_year_seq;

CREATE OR REPLACE FUNCTION public.generate_complaint_number()
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  year_part text;
  seq_num int;
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');
  seq_num := nextval('public.complaints_year_seq');
  RETURN 'C-' || year_part || '-' || LPAD(seq_num::text, 4, '0');
END;
$function$;

-- Force server-trusted fields on every insert: caller cannot spoof who
-- filed it, which branch it belongs to, or seed a fake status/thread.
CREATE OR REPLACE FUNCTION public.set_complaint_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.employee_id := public.current_user_id();
  IF NEW.employee_id IS NULL THEN
    RAISE EXCEPTION 'employee_id required';
  END IF;
  SELECT branch_id INTO NEW.branch_id FROM public.users WHERE id = NEW.employee_id;
  NEW.status := 'pending';
  NEW.logs := '[]'::jsonb;
  NEW.resolved_at := NULL;
  IF NEW.complaint_number IS NULL THEN
    NEW.complaint_number := public.generate_complaint_number();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_complaints_set_defaults
BEFORE INSERT ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.set_complaint_defaults();

CREATE TRIGGER trg_complaints_updated_at
BEFORE UPDATE ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Append a reply to the thread: the complaint's own employee, or an admin.
CREATE OR REPLACE FUNCTION public.add_complaint_reply(
  p_complaint_id uuid,
  p_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_name text;
  v_row public.complaints%ROWTYPE;
  v_text text := NULLIF(trim(COALESCE(p_text, '')), '');
  v_entry jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF v_text IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'اكتب نص الرد');
  END IF;

  SELECT * INTO v_row FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى غير موجودة');
  END IF;

  IF v_row.employee_id <> v_uid AND v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا تملك صلاحية الرد على هذه الشكوى');
  END IF;

  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  v_entry := jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'author', COALESCE(v_name, 'مستخدم'),
    'role', v_role,
    'is_admin', (v_role = 'admin'),
    'text', v_text
  );

  UPDATE public.complaints
  SET logs = logs || jsonb_build_array(v_entry), updated_at = now()
  WHERE id = p_complaint_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
END;
$function$;

-- Mark a complaint/suggestion resolved (admin only).
CREATE OR REPLACE FUNCTION public.resolve_complaint(
  p_complaint_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_row public.complaints%ROWTYPE;
  v_name text;
  v_entry jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يقدر يغلق الشكوى');
  END IF;

  SELECT * INTO v_row FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى غير موجودة');
  END IF;
  IF v_row.status = 'resolved' THEN
    RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
  END IF;

  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  v_entry := jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'author', COALESCE(v_name, 'الإدارة'),
    'role', v_role,
    'is_admin', true,
    'text', 'تم حل الشكوى/الاقتراح',
    'is_system', true
  );

  UPDATE public.complaints
  SET status = 'resolved', resolved_at = now(), logs = logs || jsonb_build_array(v_entry), updated_at = now()
  WHERE id = p_complaint_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_complaint_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_complaint_reply(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_complaint(uuid) TO authenticated;

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

-- Admin sees everything; everyone else sees only their own complaints —
-- complaints can be filed against a supervisor, so branch/region scoping
-- would leak them back to the person they're about.
CREATE POLICY complaints_select ON public.complaints
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_active()
    AND (public.current_user_role() = 'admin' OR employee_id = public.current_user_id())
  );

CREATE POLICY complaints_insert ON public.complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_active() AND employee_id = public.current_user_id()
  );

-- All state changes (reply/resolve) go through the SECURITY DEFINER RPCs above.
CREATE POLICY complaints_update_deny ON public.complaints
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY complaints_delete ON public.complaints
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- Let the existing attachment-visibility check (used by r2-storage's
-- signGet/headObject) also recognize files referenced from complaints,
-- the same way it already does for violations. SECURITY INVOKER (no
-- SECURITY DEFINER here, matches the original), so complaints_select RLS
-- applies automatically.
CREATE OR REPLACE FUNCTION public.mirsad_user_can_see_attachment(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH fname AS (
    SELECT regexp_replace(COALESCE(p_key, ''), '^.*/', '') AS f
  )
  SELECT COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM public.violations v, fname
      WHERE length(fname.f) > 0
        AND position(fname.f IN COALESCE(v.attachments::text, '')) > 0
    )
    OR EXISTS (
      SELECT 1 FROM public.complaints c, fname
      WHERE length(fname.f) > 0
        AND position(fname.f IN COALESCE(c.attachments::text, '')) > 0
    )
  ), false);
$function$;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
