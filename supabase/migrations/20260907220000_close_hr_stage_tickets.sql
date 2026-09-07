-- Retire the HR workflow stage: tickets waiting on HR are closed as finally approved.
UPDATE public.violations
SET
  state = 'closed',
  status_text = 'معتمدة نهائياً',
  logs = COALESCE(logs, '[]'::jsonb) || jsonb_build_object(
    'date', to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'),
    'user', 'النظام',
    'role', 'النظام',
    'action', 'إغلاق تلقائي',
    'note', 'أُغلقت المخالفة بعد إلغاء مرحلة الموارد البشرية'
  ),
  updated_at = now()
WHERE state = 'hr';
