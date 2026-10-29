-- Grant internal-control (auditor) the same complaint management surface as admin:
-- list all complaints, reply, resolve, and read attachments.
-- Also restore complaint attachment create finalization (temp_ → complaints/{id}/…),
-- which was incorrectly always denied for operation = 'create'.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_manage_complaints()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.current_user_is_active()
    AND (
      public.current_user_role() IN ('admin', 'auditor')
      OR public.user_has_platform_perm('manage_complaints')
    );
$function$;

REVOKE ALL ON FUNCTION public.can_manage_complaints() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_complaints() TO authenticated, service_role;

DROP POLICY IF EXISTS complaints_select ON public.complaints;
CREATE POLICY complaints_select ON public.complaints
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      public.can_manage_complaints()
      OR employee_id = public.current_user_id()
    )
  );

DROP POLICY IF EXISTS complaints_delete ON public.complaints;
CREATE POLICY complaints_delete ON public.complaints
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.add_complaint_reply(
  p_complaint_id uuid,
  p_text text,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_manager boolean := public.can_manage_complaints();
  v_name text;
  v_row public.complaints%ROWTYPE;
  v_text text := NULLIF(trim(COALESCE(p_text, '')), '');
  v_atts jsonb := COALESCE(p_attachments, '[]'::jsonb);
  v_entry jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF jsonb_typeof(v_atts) IS DISTINCT FROM 'array' THEN
    v_atts := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO v_atts
  FROM jsonb_array_elements(v_atts) AS elem
  WHERE COALESCE(elem ->> 'p', elem ->> 'path', elem ->> 'u', elem ->> 'url') IS NOT NULL
    AND COALESCE(elem ->> '__anon', '') IS DISTINCT FROM 'true';

  IF v_text IS NULL AND jsonb_array_length(v_atts) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'اكتب نص الرد أو أرفق ملفاً');
  END IF;

  SELECT * INTO v_row FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى غير موجودة');
  END IF;

  IF v_row.employee_id <> v_uid AND NOT v_manager THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا تملك صلاحية الرد على هذه الشكوى');
  END IF;

  IF v_row.status IN ('resolved', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى محلولة — الرد مقفول');
  END IF;

  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  IF NOT v_manager
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(v_row.attachments, '[]'::jsonb)) AS elem
       WHERE (elem ->> '__anon') = 'true'
          OR (elem -> '__anon') = 'true'::jsonb
     )
  THEN
    v_name := 'مجهول';
  END IF;

  v_entry := jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'author', COALESCE(v_name, 'مستخدم'),
    'role', v_role,
    'is_admin', v_manager,
    'text', COALESCE(v_text, ''),
    'attachments', v_atts
  );

  UPDATE public.complaints
  SET logs = logs || jsonb_build_array(v_entry), updated_at = now()
  WHERE id = p_complaint_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_complaint_reply(uuid, text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.resolve_complaint(uuid);
DROP FUNCTION IF EXISTS public.resolve_complaint(uuid, text);

CREATE OR REPLACE FUNCTION public.resolve_complaint(
  p_complaint_id uuid,
  p_decision text DEFAULT NULL
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
  v_decision text;
  v_status text;
  v_text text;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF NOT public.can_manage_complaints() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا تملك صلاحية إغلاق الشكوى');
  END IF;

  SELECT * INTO v_row FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى غير موجودة');
  END IF;

  v_decision := lower(btrim(COALESCE(p_decision, '')));
  IF v_decision NOT IN ('resolved', 'accepted', 'rejected') THEN
    v_decision := CASE WHEN v_row.kind = 'suggestion' THEN 'accepted' ELSE 'resolved' END;
  END IF;
  IF v_row.kind IS DISTINCT FROM 'suggestion' AND v_decision IN ('accepted', 'rejected') THEN
    v_decision := 'resolved';
  END IF;

  IF v_row.status IN ('resolved', 'rejected') THEN
    RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
  END IF;

  IF v_decision = 'rejected' THEN
    v_status := 'rejected';
    v_text := 'تم رفض الاقتراح';
  ELSIF v_decision = 'accepted' THEN
    v_status := 'resolved';
    v_text := 'تم قبول الاقتراح';
  ELSE
    v_status := 'resolved';
    v_text := 'تم حل الشكوى';
  END IF;

  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  v_entry := jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'author', COALESCE(v_name, 'الإدارة'),
    'role', v_role,
    'is_admin', true,
    'text', v_text,
    'is_system', true
  );

  UPDATE public.complaints
  SET status = v_status, resolved_at = now(), logs = logs || jsonb_build_array(v_entry), updated_at = now()
  WHERE id = p_complaint_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_complaint(uuid, text) TO authenticated;

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
  v_attachments jsonb;
  v_complaint_employee_id uuid;
  v_complaint_status text;
  v_privileged boolean := false;
  v_allowed boolean := false;
  v_service boolean := (auth.role() = 'service_role');
BEGIN
  v_privileged := v_service OR v_role = 'admin' OR public.user_has_platform_perm('act_all_tickets');

  IF (NOT v_service AND (auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()))
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
           v.source_role::text, v.created_at, v.attachments
      INTO v_state, v_employee_id, v_branch_id, v_observer_id,
           v_source_role, v_created_at, v_attachments
    FROM public.violations v
    WHERE v.id = p_record_id;
    IF NOT FOUND OR (p_expected_state IS NOT NULL AND v_state <> p_expected_state) THEN
      RETURN false;
    END IF;

    IF p_operation = 'create' THEN
      v_allowed := v_service
        OR (
          v_observer_id = v_uid
          AND v_source_role = v_role
          AND public.athar_attachment_json_has_key(v_attachments, p_from_key)
        );
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
        OR (v_observer_id = v_uid)
        OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
        OR (v_state = 'sup' AND v_role = 'supervisor'
            AND v_branch_id = ANY (public.current_user_supervised_branches()))
        OR (v_state = 'aud' AND v_role = 'auditor')
        OR (v_state = 'mgt' AND v_role = 'manager')
        OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
    END IF;
    RETURN v_allowed;
  END IF;

  SELECT c.employee_id, c.status, c.attachments
    INTO v_complaint_employee_id, v_complaint_status, v_attachments
  FROM public.complaints c
  WHERE c.id = p_record_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_operation = 'create' THEN
    -- Owner may finish temp→final while the temp key is still referenced.
    RETURN v_privileged
      OR (
        v_complaint_status = 'pending'
        AND v_complaint_employee_id = v_uid
        AND public.athar_attachment_json_has_key(v_attachments, p_from_key)
      );
  END IF;

  IF p_operation = 'reply' THEN
    RETURN v_privileged
      OR public.can_manage_complaints()
      OR (v_complaint_status = 'pending' AND v_complaint_employee_id = v_uid);
  END IF;

  -- repair: allow owner or complaint managers to heal stranded temp_ refs.
  RETURN v_privileged
    OR public.can_manage_complaints()
    OR v_complaint_employee_id = v_uid;
END;
$function$;

REVOKE ALL ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.athar_attachment_can_read(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  ok boolean;
BEGIN
  IF auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()
     OR NOT public.athar_attachment_key_is_valid(p_key) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.violations v
    WHERE (
      public.athar_attachment_json_has_key(v.attachments, p_key)
      OR public.athar_attachment_logs_have_key(v.logs, p_key)
      OR public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
    )
    AND (
      v_role IN ('admin', 'manager', 'auditor')
      OR public.user_has_platform_perm('view_all_tickets')
      OR (v_role = 'hr' AND v.state::text = 'hr')
      OR (v_role = 'employee' AND v.employee_id = v_uid)
      OR (v_role = 'observer' AND v.observer_id = v_uid)
      OR (v_role = 'supervisor' AND v.branch_id = ANY(public.current_user_supervised_branches()))
      OR (v_role = 'branch_manager' AND (
        v.employee_id = v_uid
        OR v.branch_id = public.current_user_branch_id()
      ))
    )
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
      OR EXISTS (
        SELECT 1
        FROM public.athar_r2_legacy_attachment_keys l
        WHERE l.record_type = 'violation'
          AND l.record_id = v.id
          AND l.object_key = p_key
      )
      OR p_key LIKE 'temp_%'
    )
  ) INTO ok;

  IF ok THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.complaints c
    WHERE (
      public.athar_attachment_json_has_key(c.attachments, p_key)
      OR public.athar_attachment_logs_have_key(c.logs, p_key)
      OR public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
    )
    AND (public.can_manage_complaints() OR c.employee_id = v_uid)
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
      OR EXISTS (
        SELECT 1
        FROM public.athar_r2_legacy_attachment_keys l
        WHERE l.record_type = 'complaint'
          AND l.record_id = c.id
          AND l.object_key = p_key
      )
      OR p_key LIKE 'temp_%'
    )
  ) INTO ok;

  RETURN COALESCE(ok, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.athar_attachment_can_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athar_attachment_can_read(text) TO authenticated, service_role;

COMMIT;
