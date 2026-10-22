-- Allow an administrator (or explicit all-ticket operator) to repair a
-- temp attachment created by another user. Normal create/reply operations
-- still require ownership of the temp key.
CREATE OR REPLACE FUNCTION public.athar_attachment_destination_can_modify(
  p_record_type text,
  p_record_id uuid,
  p_from_key text,
  p_to_key text,
  p_operation text,
  p_expected_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_state text;
  v_employee_id uuid;
  v_branch_id uuid;
  v_observer_id uuid;
  v_source_role text;
  v_created_at timestamptz;
  v_complaint_employee_id uuid;
  v_complaint_status text;
  v_privileged boolean := false;
  v_allowed boolean := false;
BEGIN
  v_privileged := v_role = 'admin' OR public.user_has_platform_perm('act_all_tickets');

  IF auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()
     OR p_record_id IS NULL
     OR p_record_type NOT IN ('violation', 'complaint')
     OR p_operation NOT IN ('create', 'reply', 'repair')
     OR (NOT v_privileged AND NOT public.athar_attachment_temp_key_is_owned(p_from_key, auth.uid()))
     OR NOT public.athar_attachment_key_is_canonical(p_to_key, p_record_type, p_record_id)
     OR regexp_replace(p_from_key, '^.*/', '') <> regexp_replace(p_to_key, '^.*/', '') THEN
    RETURN false;
  END IF;

  IF p_record_type = 'violation' THEN
    SELECT v.state::text, v.employee_id, v.branch_id, v.observer_id,
           v.source_role::text, v.created_at
      INTO v_state, v_employee_id, v_branch_id, v_observer_id,
           v_source_role, v_created_at
    FROM public.violations v
    WHERE v.id = p_record_id;
    IF NOT FOUND OR (p_expected_state IS NOT NULL AND v_state <> p_expected_state) THEN
      RETURN false;
    END IF;

    IF p_operation = 'create' THEN
      v_allowed := v_observer_id = v_uid
        AND v_source_role = v_role
        AND v_created_at >= now() - interval '15 minutes';
    ELSIF p_operation = 'reply' THEN
      v_allowed := v_privileged
        OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
        OR (v_state = 'sup' AND v_role = 'supervisor'
            AND v_branch_id = ANY (public.current_user_supervised_branches()))
        OR (v_state = 'aud' AND v_role = 'auditor')
        OR (v_state = 'mgt' AND v_role = 'manager')
        OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
    ELSE
      v_allowed := v_privileged
        OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
        OR (v_state = 'sup' AND v_role = 'supervisor'
            AND v_branch_id = ANY (public.current_user_supervised_branches()))
        OR (v_state = 'aud' AND v_role = 'auditor')
        OR (v_state = 'mgt' AND v_role = 'manager')
        OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
    END IF;
    RETURN v_allowed;
  END IF;

  SELECT c.employee_id, c.status
    INTO v_complaint_employee_id, v_complaint_status
  FROM public.complaints c
  WHERE c.id = p_record_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_operation = 'create' THEN
    RETURN false;
  END IF;
  RETURN v_privileged
    OR (v_complaint_status = 'pending' AND v_complaint_employee_id = v_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) TO authenticated, service_role;
