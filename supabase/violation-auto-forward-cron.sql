-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — جدولة التمرير التلقائي (كل دقيقة)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- المتطلبات: شغّل أولاً supabase/mirsad-auto-forward-sql.sql
--
-- لا HTTP — لا 401 — يعمل مباشرة داخل قاعدة البيانات.

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname = 'athar-violation-auto-forward';

select cron.schedule(
  'athar-violation-auto-forward',
  '* * * * *',
  $$ select public.mirsad_auto_forward_tick(); $$
);

-- تحقق:
-- select jobid, jobname, schedule, left(command, 80) from cron.job where jobname = 'athar-violation-auto-forward';
--
-- اختبار يدوي:
-- select public.mirsad_auto_forward_overdue_violations();
