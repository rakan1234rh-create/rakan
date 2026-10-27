-- Rename legacy "تدقيق" status labels to "الرقابة الداخلية" (display text only).
-- Internal state codes (aud) and field keys (audit_reply) stay unchanged.

UPDATE public.violations
SET status_text = 'بانتظار الرقابة الداخلية'
WHERE btrim(COALESCE(status_text, '')) IN (
  'بانتظار التدقيق',
  'بانتظار رد المدقق'
);

UPDATE public.violations
SET status_text = 'ملغاة بقرار الرقابة الداخلية'
WHERE btrim(COALESCE(status_text, '')) = 'ملغاة بقرار التدقيق';

-- Patch live RPC definitions so new auto-forward / guard messages use the new wording.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'athar_auto_forward_single_canonical'
    AND pg_get_function_identity_arguments(p.oid) = 'p_violation_id uuid, p_direction text';

  IF def IS NOT NULL THEN
    def := replace(def, 'بانتظار التدقيق', 'بانتظار الرقابة الداخلية');
    def := replace(
      def,
      'تمرير تلقائي.*(المدقق|بانتظار رد المدقق)',
      'تمرير تلقائي.*(المدقق|بانتظار رد المدقق|الرقابة|بانتظار الرقابة|بانتظار التدقيق)'
    );
    EXECUTE def;
  END IF;

  SELECT pg_get_functiondef(p.oid)
  INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'append_violation_log_with_guard'
  ORDER BY p.oid
  LIMIT 1;

  IF def IS NOT NULL AND position('انتقال التدقيق غير مصرح' in def) > 0 THEN
    def := replace(def, 'انتقال التدقيق غير مصرح', 'انتقال الرقابة الداخلية غير مصرح');
    EXECUTE def;
  END IF;
END $$;
