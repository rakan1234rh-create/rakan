-- =============================================
-- إصلاح Race Condition في submitResp
-- =============================================
-- المشكلة: submitResp يقرأ logs الحالية ثم يعدّلها في خطوتين منفصلتين.
-- إذا أرسل مستخدمان ردّين في نفس الوقت، رد واحد يضيع (Lost Update).
-- الحل: استخدام RPC ذري يُلحق السجل + يحدّث كل الحقول في عملية واحدة.
--
-- طريقة النشر:
--   1. شغّل هذا الملف في Supabase SQL Editor
--   2. index.html يستدعي هذا RPC الآن مباشرة (تم التعديل مسبقاً)
-- =============================================

-- نسخة بسيطة بدون guard (للاستخدام العام)
CREATE OR REPLACE FUNCTION append_violation_log(
  p_violation_id UUID,
  p_log_entry JSONB,
  p_new_state TEXT DEFAULT NULL,
  p_status_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE violations
  SET
    logs          = COALESCE(logs, '[]'::jsonb) || p_log_entry,
    state         = COALESCE(p_new_state::public.violation_state, state),
    status_text   = COALESCE(p_status_text, status_text),
    updated_at    = now()
  WHERE
    id = p_violation_id
  RETURNING jsonb_build_object(
    'ok', true,
    'id', id,
    'logs', logs
  );
$$;

-- =============================================
-- النسخة الرئيسية مع optimistic lock + كل الحقول
-- =============================================
-- تُستخدم من submitResp في index.html.
-- تتحقق أن حالة التذكرة لا تزال في المرحلة المتوقعة قبل التحديث
-- وتحدّث: logs, state, status_text, reply_field, attachments, auto_forwarded flags

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
  -- جلب الـ logs الحالية مع التحقق من الحالة (optimistic lock)
  SELECT logs INTO v_logs
  FROM violations
  WHERE id = p_violation_id AND state = p_expected_state::public.violation_state;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'حالة التذكرة تغيّرت بالفعل — يرجى إعادة تحميل الصفحة'
    );
  END IF;

  -- تحديث ذري: إلحاق السجل + كل الحقول في عملية واحدة
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
    -- حالة تغيّرت بين SELECT و UPDATE (سباق ضيق جداً)
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'تعارض — تم تحديث التذكرة بالتوازي، يرجى إعادة المحاولة'
    );
  END IF;

  -- تحديث حقل الرد الديناميكي (employee_reply, supervisor_reply, إلخ)
  IF p_reply_field IS NOT NULL AND p_reply_field != '' THEN
    EXECUTE format('UPDATE violations SET %I = $1 WHERE id = $2', p_reply_field)
    USING p_reply_text, p_violation_id;
  END IF;

  -- إرجاع البيانات المحدّثة
  RETURN (
    SELECT jsonb_build_object('ok', true, 'id', id, 'logs', logs, 'state', state)
    FROM violations
    WHERE id = p_violation_id
  );
END;
$$;