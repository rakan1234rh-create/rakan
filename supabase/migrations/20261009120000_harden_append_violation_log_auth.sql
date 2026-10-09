-- Harden append_violation_log_with_guard:
-- require authenticated active user with role/state match,
-- whitelist reply columns, cap payload sizes, tighten search_path.

CREATE OR REPLACE FUNCTION public.append_violation_log_with_guard(
  p_violation_id uuid,
  p_expected_state text,
  p_log_entry jsonb,
  p_new_state text DEFAULT NULL,
  p_status_text text DEFAULT NULL,
  p_reply_field text DEFAULT NULL,
  p_reply_text text DEFAULT NULL,
  p_attachments jsonb DEFAULT NULL,
  p_reset_auto_forwarded_emp boolean DEFAULT false,
  p_reset_auto_forwarded_sup boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_role text;
  v_allowed boolean := false;
  v_logs jsonb;
  v_atts jsonb;
  v_employee_id uuid;
  v_branch_id uuid;
  v_allowed_reply text[] := ARRAY[
    'employee_reply',
    'supervisor_reply',
    'audit_reply',
    'management_reply',
    'hr_reply'
  ];
  v_allowed_states text[] := ARRAY[
    'emp', 'sup', 'aud', 'mgt', 'hr', 'closed', 'Warning_Issued', 'uploading'
  ];
BEGIN
  v_uid := public.current_user_id();
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  v_role := public.current_user_role();

  IF p_expected_state IS NULL OR p_expected_state = ''
     OR NOT (p_expected_state = ANY (v_allowed_states)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'حالة متوقعة غير صالحة');
  END IF;

  IF p_new_state IS NOT NULL AND p_new_state <> ''
     AND NOT (p_new_state = ANY (v_allowed_states)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'حالة جديدة غير صالحة');
  END IF;

  IF p_reply_field IS NOT NULL AND p_reply_field <> ''
     AND NOT (p_reply_field = ANY (v_allowed_reply)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'حقل رد غير صالح');
  END IF;

  IF p_reply_text IS NOT NULL AND char_length(p_reply_text) > 8000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نص الرد طويل جداً');
  END IF;

  IF p_status_text IS NOT NULL AND char_length(p_status_text) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نص الحالة طويل جداً');
  END IF;

  IF p_log_entry IS NULL OR jsonb_typeof(p_log_entry) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سجل الإجراء غير صالح');
  END IF;

  IF octet_length(p_log_entry::text) > 16000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سجل الإجراء كبير جداً');
  END IF;

  SELECT employee_id, branch_id, logs
    INTO v_employee_id, v_branch_id, v_logs
  FROM public.violations
  WHERE id = p_violation_id
    AND state = p_expected_state::public.violation_state;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'حالة التذكرة تغيّرت بالفعل — يرجى إعادة تحميل الصفحة'
    );
  END IF;

  IF v_role = 'admin'
     OR public.user_has_platform_perm('act_all_tickets') THEN
    v_allowed := true;
  ELSIF p_expected_state = 'emp'
        AND v_role IN ('employee', 'branch_manager')
        AND v_employee_id = v_uid THEN
    v_allowed := true;
  ELSIF p_expected_state = 'sup'
        AND v_role = 'supervisor'
        AND v_branch_id = ANY (public.current_user_supervised_branches()) THEN
    v_allowed := true;
  ELSIF p_expected_state = 'aud' AND v_role = 'auditor' THEN
    v_allowed := true;
  ELSIF p_expected_state = 'mgt' AND v_role = 'manager' THEN
    v_allowed := true;
  ELSIF p_expected_state = 'hr'
        AND (
          v_role = 'hr'
          OR public.user_has_platform_perm('act_as_hr')
          OR (
            -- HR queue auto-close (no reply field): admins/viewers with view_all_tickets
            public.user_has_platform_perm('view_all_tickets')
            AND COALESCE(NULLIF(p_new_state, ''), '') = 'closed'
            AND (p_reply_field IS NULL OR p_reply_field = '')
          )
        ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'غير مصرح بهذا الإجراء');
  END IF;

  v_atts := p_attachments;
  IF v_atts IS NOT NULL AND jsonb_typeof(v_atts) = 'string' THEN
    BEGIN
      v_atts := (v_atts #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      v_atts := NULL;
    END;
  END IF;

  IF v_atts IS NOT NULL AND jsonb_typeof(v_atts) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المرفقات غير صالحة');
  END IF;

  IF v_atts IS NOT NULL AND jsonb_array_length(v_atts) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'عدد المرفقات كبير جداً');
  END IF;

  IF v_atts IS NOT NULL AND octet_length(v_atts::text) > 200000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'بيانات المرفقات كبيرة جداً');
  END IF;

  UPDATE public.violations
  SET
    logs               = COALESCE(v_logs, '[]'::jsonb) || jsonb_build_array(p_log_entry),
    state              = COALESCE(NULLIF(p_new_state, '')::public.violation_state, state),
    status_text        = COALESCE(p_status_text, status_text),
    attachments        = COALESCE(v_atts, attachments),
    auto_forwarded_emp = CASE WHEN p_reset_auto_forwarded_emp THEN FALSE ELSE auto_forwarded_emp END,
    auto_forwarded_sup = CASE WHEN p_reset_auto_forwarded_sup THEN FALSE ELSE auto_forwarded_sup END,
    updated_at         = now()
  WHERE id = p_violation_id
    AND state = p_expected_state::public.violation_state;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'تعارض — تم تحديث التذكرة بالتوازي، يرجى إعادة المحاولة'
    );
  END IF;

  IF p_reply_field IS NOT NULL AND p_reply_field <> '' THEN
    EXECUTE format('UPDATE public.violations SET %I = $1 WHERE id = $2', p_reply_field)
    USING p_reply_text, p_violation_id;
  END IF;

  RETURN (
    SELECT jsonb_build_object('ok', true, 'id', id, 'logs', logs, 'state', state)
    FROM public.violations
    WHERE id = p_violation_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.append_violation_log_with_guard(
  uuid, text, jsonb, text, text, text, text, jsonb, boolean, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.append_violation_log_with_guard(
  uuid, text, jsonb, text, text, text, text, jsonb, boolean, boolean
) TO authenticated;

-- Defense in depth: never reveal whether an email is registered.
CREATE OR REPLACE FUNCTION public.check_platform_email_for_reset(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT true;
$$;

REVOKE ALL ON FUNCTION public.check_platform_email_for_reset(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_platform_email_for_reset(text) TO anon, authenticated;
