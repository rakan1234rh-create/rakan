-- Close only management-stage violations dated before 2026-09-21.
-- This migration is idempotent and skips rows that no longer match at execution time.
WITH target AS (
  SELECT id
  FROM public.violations
  WHERE violation_date < DATE '2026-09-21'
    AND state = 'mgt'::public.violation_state
    AND btrim(COALESCE(status_text, '')) = 'بانتظار القرار الإداري'
  ORDER BY violation_date, ticket_number
  LIMIT 1000
)
UPDATE public.violations AS v
SET state = 'closed'::public.violation_state,
    status_text = 'مغلقة',
    logs = COALESCE(v.logs, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
      'user', 'الإدارة',
      'role', 'القرار الإداري',
      'action', 'إغلاق فقط',
      'note', 'إغلاق فقط بناءً على تاريخ المخالفة قبل 2026-09-21'
    )),
    updated_at = now()
FROM target
WHERE v.id = target.id
  AND v.state = 'mgt'::public.violation_state
  AND btrim(COALESCE(v.status_text, '')) = 'بانتظار القرار الإداري';
