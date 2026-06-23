-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — إلغاء كرون التمرير القديم (polling / احتياط يومي)
-- التمرير الفعلي: pg_cron عند due_at لكل job + استدعاء violation-push
-- شغّل: supabase/on-demand-scheduling.sql
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(j.jobid)
from cron.job j
where j.jobname in (
  'athar-violation-auto-forward',
  'athar-violation-forward-fallback',
  'auto-forward-violations'
);

-- تحقق:
-- select jobname, schedule from cron.job where jobname like 'athar-fwd-%' or jobname like 'athar-bc-exp-%';
