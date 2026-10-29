-- Tighten complaint MANAGEMENT (view-all / reply-as-manager / resolve)
-- to admin + auditor only.
--
-- PR #378 correctly added auditor, but can_manage_complaints() also
-- accepted user_has_platform_perm('manage_complaints'). That platform
-- override path can grant full complaint visibility to any role/user
-- (e.g. stale user overrides), which is broader than intended.
--
-- Historical access before #378: admin managed all; everyone else only
-- saw/replied to their own. Keep that + auditor (إدارة الرقابة الداخلية).

BEGIN;

CREATE OR REPLACE FUNCTION public.can_manage_complaints()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.current_user_is_active()
    AND public.current_user_role() IN ('admin', 'auditor');
$function$;

REVOKE ALL ON FUNCTION public.can_manage_complaints() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_complaints() TO authenticated, service_role;

COMMIT;
