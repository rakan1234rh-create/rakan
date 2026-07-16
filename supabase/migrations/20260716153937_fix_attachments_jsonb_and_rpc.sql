-- Fix double-encoded attachments (jsonb string wrapping a JSON array)
-- and accept p_attachments as jsonb so PostgREST/RPC never store a JSON string.

UPDATE public.violations
SET attachments = (attachments #>> '{}')::jsonb
WHERE jsonb_typeof(attachments) = 'string'
  AND left(trim(attachments #>> '{}'), 1) = '[';

DROP FUNCTION IF EXISTS public.append_violation_log_with_guard(
  uuid, text, jsonb, text, text, text, text, text, boolean, boolean
);

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
SET search_path TO 'public'
AS $function$
DECLARE
  v_logs JSONB;
  v_atts JSONB;
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

  v_atts := p_attachments;
  IF v_atts IS NOT NULL AND jsonb_typeof(v_atts) = 'string' THEN
    BEGIN
      v_atts := (v_atts #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      v_atts := NULL;
    END;
  END IF;

  UPDATE violations
  SET
    logs                    = COALESCE(v_logs, '[]'::jsonb) || p_log_entry,
    state                   = COALESCE(p_new_state::public.violation_state, state),
    status_text             = COALESCE(p_status_text, status_text),
    attachments             = COALESCE(v_atts, attachments),
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
$function$;
