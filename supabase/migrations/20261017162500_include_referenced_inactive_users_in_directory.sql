-- Keep historical violation names resolvable for non-management users.
-- Inactive users remain non-selectable in the violation form because the UI
-- requires is_active, but their names remain available for existing records.
BEGIN;

DROP FUNCTION IF EXISTS public.get_user_directory();

CREATE OR REPLACE FUNCTION public.get_user_directory()
RETURNS TABLE (
  id uuid,
  name text,
  role public.user_role,
  branch_id uuid,
  department_id uuid,
  employee_number text,
  job_title text,
  avatar_key text,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_active() THEN
    RAISE EXCEPTION 'يلزم حساب نشط لقراءة دليل الموظفين'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.name,
    u.role,
    u.branch_id,
    u.department_id,
    u.employee_number,
    u.job_title,
    u.avatar_key,
    u.is_active
  FROM public.users AS u
  WHERE u.is_active IS TRUE
     OR EXISTS (
       SELECT 1
       FROM public.violations AS v
       WHERE v.employee_id = u.id
          OR v.observer_id = u.id
          OR v.supervisor_id = u.id
     )
  ORDER BY u.name, u.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_directory() TO authenticated;

COMMIT;
