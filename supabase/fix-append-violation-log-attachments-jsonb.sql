-- إصلاح 400 عند تقديم رد الموظف
-- السبب: attachments عمود jsonb لكن p_attachments كان text → COALESCE(text, jsonb) يفشل (42804)

CREATE OR REPLACE FUNCTION append_violation_log_with_guard(
  p_violation_id UUID,
  p_expected_state TEXT,
  p_log_entry JSONB,
  p_new_state TEXT DEFAULT NULL,
  p_status_text TEXT DEFAULT NULL,
  p_reply_field TEXT DEFAULT NULL,
  p_reply_text TEXT DEFAULT NULL,
  p_attachments TEXT DEFAULT NULL,
  p_reset_auto_forwarded_emp BOOLEAN DEFAULT FALSE,
  p_reset_auto_forwarded_sup BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logs JSONB;
BEGIN
  SELECT logs INTO v_logs
  FROM violations
  WHERE id = p_violation_id AND state = p_expected_state::public.violation_state;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'حالة التذكرة تغيّرت بالفعل — يرجى إعادة تحميل الصفحة'
    );
  END IF;

  UPDATE violations
  SET
    logs                    = COALESCE(v_logs, '[]'::jsonb) || p_log_entry,
    state                   = COALESCE(p_new_state::public.violation_state, state),
    status_text             = COALESCE(p_status_text, status_text),
    attachments             = COALESCE(p_attachments::jsonb, attachments),
    auto_forwarded_emp      = CASE WHEN p_reset_auto_forwarded_emp THEN FALSE ELSE auto_forwarded_emp END,
    auto_forwarded_sup      = CASE WHEN p_reset_auto_forwarded_sup THEN FALSE ELSE auto_forwarded_sup END,
    updated_at              = now()
  WHERE id = p_violation_id AND state = p_expected_state::public.violation_state;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'تعارض — تم تحديث التذكرة بالتوازي، يرجى إعادة المحاولة'
    );
  END IF;

  IF p_reply_field IS NOT NULL AND p_reply_field != '' THEN
    EXECUTE format('UPDATE violations SET %I = $1 WHERE id = $2', p_reply_field)
    USING p_reply_text, p_violation_id;
  END IF;

  RETURN (
    SELECT jsonb_build_object('ok', true, 'id', id, 'logs', logs, 'state', state)
    FROM violations
    WHERE id = p_violation_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION append_violation_log_with_guard(
  uuid, text, jsonb, text, text, text, text, text, boolean, boolean
) TO authenticated, anon, service_role;
