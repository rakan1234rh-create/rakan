-- WhatsApp after violation recording needs the subject phone.
-- get_user_directory intentionally omits phone (PII). Observers/supervisors
-- who create tickets therefore had emp.phone empty and wa.me never opened.
-- Narrow RPC: same roles as violations_insert, only active employee/branch_manager subjects.

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
    RAISE EXCEPTION 'يلزم حساب نشط لقراءة جوال الموظف'
      USING ERRCODE = '42501';
  END IF;

  v_role := public.current_user_role();
  -- Matches public.violations INSERT with_check roles.
  IF v_role IS NULL OR v_role <> ALL (ARRAY['admin', 'manager', 'observer', 'supervisor']) THEN
    RAISE EXCEPTION 'غير مصرح بقراءة جوال الموظف للمخالفة'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT NULLIF(btrim(u.phone), '')
    INTO v_phone
  FROM public.users AS u
  WHERE u.id = p_employee_id
    AND u.is_active IS TRUE
    AND u.role IN ('employee'::public.user_role, 'branch_manager'::public.user_role)
  LIMIT 1;

  RETURN v_phone;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_violation_subject_phone(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_violation_subject_phone(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_violation_subject_phone(uuid) TO authenticated;

COMMIT;
