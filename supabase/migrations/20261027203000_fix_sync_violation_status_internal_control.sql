-- Root cause: trg_violation_status / sync_violation_status() rewrote aud
-- status_text back to the legacy label «بانتظار التدقيق» on every UPDATE.
-- Align the trigger with إدارة الرقابة الداخلية and backfill remaining rows.

CREATE OR REPLACE FUNCTION public.sync_violation_status()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.status_text := CASE NEW.state
    WHEN 'emp' THEN 'بانتظار رد الموظف'
    WHEN 'sup' THEN 'بانتظار رد المشرف'
    WHEN 'aud' THEN 'بانتظار الرقابة الداخلية'
    WHEN 'mgt' THEN 'بانتظار القرار الإداري'
    WHEN 'hr' THEN 'بانتظار الموارد البشرية'
    WHEN 'Warning_Issued' THEN 'تنبيه إداري صادر'
    WHEN 'closed' THEN COALESCE(NEW.status_text, 'مغلقة')
  END;
  IF NEW.state = 'closed' AND OLD.state <> 'closed' THEN
    NEW.closed_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.violations
SET status_text = 'بانتظار الرقابة الداخلية'
WHERE state = 'aud'
  AND btrim(COALESCE(status_text, '')) IN (
    'بانتظار التدقيق',
    'بانتظار رد المدقق'
  );

UPDATE public.violations
SET status_text = 'ملغاة بقرار الرقابة الداخلية'
WHERE btrim(COALESCE(status_text, '')) = 'ملغاة بقرار التدقيق';
