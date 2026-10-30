-- Observers/supervisors load colleagues via get_user_directory(), which
-- intentionally omits phone. WhatsApp compose after recording a violation needs
-- the subject's mobile only for that submit action — not a directory-wide dump.
-- Future creates only; no historical WhatsApp resend.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_violation_subject_phone(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
  v_phone text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_active() THEN
    RAISE EXCEPTION 'يلزم حساب نشط لقراءة جوال موظف المخالفة'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_role := public.current_user_role();
  IF v_role IS DISTINCT FROM 'admin'
     AND v_role IS DISTINCT FROM 'observer'
     AND v_role IS DISTINCT FROM 'supervisor' THEN
    RAISE EXCEPTION 'غير مصرح بقراءة جوال موظف المخالفة'
      USING ERRCODE = '42501';
  END IF;

  SELECT NULLIF(btrim(u.phone), '')
    INTO v_phone
  FROM public.users AS u
  WHERE u.id = p_employee_id
    AND u.is_active IS TRUE
    AND u.role IN ('employee'::public.user_role, 'branch_manager'::public.user_role);

  RETURN v_phone;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_violation_subject_phone(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_violation_subject_phone(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_violation_subject_phone(uuid) TO authenticated, service_role;

COMMIT;
