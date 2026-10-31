-- Restore attachment finalize / modify / rollback RPCs missing from athar_DB.
-- Live evidence (2026-10-31): observer issue V-2026-0974 kept temp_* paths because
-- athar_finalize_attachment_path and athar_attachment_move_rollback_allowed were absent
-- (PostgREST: "Could not find the function … in the schema cache"), while employee
-- reply finalizes via append_violation_log_with_guard and never needs these RPCs.
-- destination_can_modify already exists (later migrations); do not redefine it here.

BEGIN;

CREATE OR REPLACE FUNCTION public.athar_attachment_is_frozen_legacy_key(
  p_record_type text,
  p_record_id uuid,
  p_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.athar_r2_legacy_attachment_keys l
    WHERE l.record_type = p_record_type
      AND l.record_id = p_record_id
      AND l.object_key = p_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.athar_attachment_can_modify(p_key text)
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
  v_complaint_employee_id uuid;
  v_complaint_status text;
BEGIN
  IF auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()
     OR NOT public.athar_attachment_key_is_valid(p_key) THEN
    RETURN false;
  END IF;

  SELECT v.state::text, v.employee_id, v.branch_id
    INTO v_state, v_employee_id, v_branch_id
  FROM public.violations v
  WHERE (public.athar_attachment_json_has_key(v.attachments, p_key)
         OR public.athar_attachment_logs_have_key(v.logs, p_key))
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
      OR public.athar_attachment_is_frozen_legacy_key('violation', v.id, p_key)
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN v_role = 'admin'
      OR public.user_has_platform_perm('act_all_tickets')
      OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
      OR (v_state = 'sup' AND v_role = 'supervisor'
          AND v_branch_id = ANY (public.current_user_supervised_branches()))
      OR (v_state = 'aud' AND v_role = 'auditor')
      OR (v_state = 'mgt' AND v_role = 'manager')
      OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
  END IF;

  SELECT c.employee_id, c.status
    INTO v_complaint_employee_id, v_complaint_status
  FROM public.complaints c
  WHERE (public.athar_attachment_json_has_key(c.attachments, p_key)
         OR public.athar_attachment_logs_have_key(c.logs, p_key))
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
      OR public.athar_attachment_is_frozen_legacy_key('complaint', c.id, p_key)
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN v_complaint_status = 'pending'
      AND (
        v_role = 'admin'
        OR public.can_manage_complaints()
        OR v_complaint_employee_id = v_uid
      );
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.athar_finalize_attachment_path(
  p_record_type text,
  p_record_id uuid,
  p_from_key text,
  p_to_key text,
  p_operation text DEFAULT 'create',
  p_expected_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_updated integer := 0;
BEGIN
  IF p_operation NOT IN ('create', 'repair')
     OR NOT public.athar_attachment_destination_can_modify(
       p_record_type, p_record_id, p_from_key, p_to_key, p_operation, p_expected_state
     ) THEN
    RETURN false;
  END IF;

  IF p_record_type = 'violation' THEN
    UPDATE public.violations v
    SET attachments = (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN item.value ->> 'p' = p_from_key THEN jsonb_set(item.value, '{p}', to_jsonb(p_to_key), true)
          WHEN item.value ->> 'path' = p_from_key THEN jsonb_set(item.value, '{path}', to_jsonb(p_to_key), true)
          ELSE item.value
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.attachments) = 'array' THEN v.attachments ELSE '[]'::jsonb END) AS item(value)
    ), updated_at = now()
    WHERE v.id = p_record_id
      AND public.athar_attachment_json_has_key(v.attachments, p_from_key);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF p_record_type = 'complaint' THEN
    UPDATE public.complaints c
    SET attachments = (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN item.value ->> 'p' = p_from_key THEN jsonb_set(item.value, '{p}', to_jsonb(p_to_key), true)
          WHEN item.value ->> 'path' = p_from_key THEN jsonb_set(item.value, '{path}', to_jsonb(p_to_key), true)
          ELSE item.value
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.attachments) = 'array' THEN c.attachments ELSE '[]'::jsonb END) AS item(value)
    ), updated_at = now()
    WHERE c.id = p_record_id
      AND public.athar_attachment_json_has_key(c.attachments, p_from_key);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN v_updated = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.athar_attachment_move_rollback_allowed(
  p_record_type text,
  p_record_id uuid,
  p_from_key text,
  p_to_key text,
  p_operation text,
  p_expected_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.athar_attachment_destination_can_modify(
           p_record_type, p_record_id, p_from_key, p_to_key, p_operation, p_expected_state
         )
    AND CASE p_record_type
      WHEN 'violation' THEN NOT EXISTS (
        SELECT 1 FROM public.violations v
        WHERE v.id = p_record_id
          AND (public.athar_attachment_json_has_key(v.attachments, p_to_key)
               OR public.athar_attachment_logs_have_key(v.logs, p_to_key))
      )
      WHEN 'complaint' THEN NOT EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = p_record_id
          AND (public.athar_attachment_json_has_key(c.attachments, p_to_key)
               OR public.athar_attachment_logs_have_key(c.logs, p_to_key))
      )
      ELSE false
    END;
$function$;

REVOKE ALL ON FUNCTION public.athar_attachment_is_frozen_legacy_key(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.athar_attachment_can_modify(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_finalize_attachment_path(text, uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_move_rollback_allowed(text, uuid, text, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.athar_attachment_can_modify(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.athar_finalize_attachment_path(text, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.athar_attachment_move_rollback_allowed(text, uuid, text, text, text, text) TO authenticated, service_role;

COMMIT;
