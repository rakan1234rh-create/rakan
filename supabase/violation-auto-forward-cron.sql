-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — معالجة jobs التمرير (كل 10 دقائق — فقط المستحقة)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- المتطلبات:
--   1) supabase/mirsad-auto-forward-sql.sql
--   2) supabase/violation-forward-jobs.sql

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname = 'athar-violation-auto-forward';

select cron.schedule(
  'athar-violation-auto-forward',
  '*/10 * * * *',
  $$ select public.mirsad_auto_forward_tick(); $$
);

-- تحقق:
-- select jobid, jobname, schedule, left(command, 80) from cron.job where jobname = 'athar-violation-auto-forward';
--
-- اختبار يدوي:
-- select public.mirsad_auto_forward_overdue_violations();
