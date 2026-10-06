-- Repair mojibake severities, job-title sync trigger, and staff job titles.
-- Root cause 1: violation_types_severity_check stored mojibake literals.
-- Root cause 2: sync_users_job_title() hardcoded mojibake job titles and
--               rewrote correct values on every INSERT/UPDATE.

ALTER TABLE public.violation_types
  DROP CONSTRAINT IF EXISTS violation_types_severity_check;

UPDATE public.violation_types
SET severity = convert_from(decode('d985d986d8aed981d8b6', 'hex'), 'UTF8')
WHERE encode(convert_to(severity, 'UTF8'), 'hex') = 'c399e280a6c399e280a0c398c2aec399c281c398c2b6';

UPDATE public.violation_types
SET severity = convert_from(decode('d985d8aad988d8b3d8b7', 'hex'), 'UTF8')
WHERE encode(convert_to(severity, 'UTF8'), 'hex') = 'c399e280a6c398c2aac399cb86c398c2b3c398c2b7';

UPDATE public.violation_types
SET severity = convert_from(decode('d8b9d8a7d984d98a', 'hex'), 'UTF8')
WHERE encode(convert_to(severity, 'UTF8'), 'hex') = 'c398c2b9c398c2a7c399e2809ec399c5a0';

ALTER TABLE public.violation_types
  ADD CONSTRAINT violation_types_severity_check
  CHECK (severity = ANY (ARRAY[
    convert_from(decode('d985d986d8aed981d8b6', 'hex'), 'UTF8'),
    convert_from(decode('d985d8aad988d8b3d8b7', 'hex'), 'UTF8'),
    convert_from(decode('d8b9d8a7d984d98a', 'hex'), 'UTF8'),
    convert_from(decode('d8add8b1d8ac', 'hex'), 'UTF8')
  ]));

CREATE OR REPLACE FUNCTION public.sync_users_job_title()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role::text = 'employee' THEN
    NEW.job_title := convert_from(decode('d8a3d8aed8b5d8a7d8a6d98a20d985d8a8d98ad8b9d8a7d8aa', 'hex'), 'UTF8');
  ELSIF NEW.role::text = 'branch_manager' THEN
    NEW.job_title := convert_from(decode('d985d8afd98ad8b120d981d8b1d8b9', 'hex'), 'UTF8');
  ELSE
    NEW.job_title := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Re-apply titles via the fixed trigger
UPDATE public.users
SET role = role
WHERE role::text IN ('employee', 'branch_manager');
