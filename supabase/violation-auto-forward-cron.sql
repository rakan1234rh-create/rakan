-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — احتياط يومي للتمرير (ليس فحصاً كل 10 دقائق)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- المتطلبات:
--   1) supabase/mirsad-auto-forward-sql.sql
--   2) supabase/violation-forward-jobs.sql
--   3) supabase/violation-forward-schedule-at-due.sql  (للترقية من نسخة قديمة)
--
-- التمرير الفعلي يحدث عبر pg_cron مُجدول عند due_at لكل job.
-- هذا الملف يضيف احتياطاً يومياً فقط للـ jobs العالقة.

create extension if not exists pg_cron with schema pg_catalog;

-- إلغاء الجدولة القديمة (كل 10 دقائق أو كل دقيقة)
select cron.unschedule(j.jobid)
from cron.job j
where j.jobname = 'athar-violation-auto-forward';

select cron.unschedule(j.jobid)
from cron.job j
where j.jobname = 'athar-violation-forward-fallback';

-- 04:00 Asia/Riyadh ≈ 01:00 UTC — مرة واحدة يومياً
select cron.schedule(
  'athar-violation-forward-fallback',
  '0 1 * * *',
  $$ select public.mirsad_auto_forward_tick(); $$
);

-- تحقق:
-- select jobid, jobname, schedule, left(command, 80) from cron.job
-- where jobname in ('athar-violation-forward-fallback') or jobname like 'athar-fwd-%'
-- order by jobname limit 30;
