-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — جدولة التمرير التلقائي (كل دقيقة)
-- شغّل في Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- المتطلبات:
-- 1) نشر violation-push (إصدار 2026-06-auto-forward-cron-v3)
-- 2) Edge Functions → Secrets → AUTO_FORWARD_CRON_SECRET
-- 3) استبدل YOUR_CRON_SECRET_HERE بالسر الحقيقي (نفس قيمة Secrets)
--
-- ملاحظة: السر يُرسل داخل body (cronSecret) لأن pg_net قد لا يمرّر x-cron-secret.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'athar-violation-auto-forward';

select cron.schedule(
  'athar-violation-auto-forward',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rizoafuxmqsddjfhbsmf.supabase.co/functions/v1/violation-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'autoForwardCron', true,
      'cronSecret', 'YOUR_CRON_SECRET_HERE'
    )
  ) as request_id;
  $$
);

-- تحقق:
-- select jobid, jobname, schedule,
--   case when command like '%YOUR_CRON_SECRET_HERE%' then 'secret placeholder!' else 'secret set' end,
--   case when command like '%cronSecret%' then 'body ok' else 'body wrong' end
-- from cron.job where jobname = 'athar-violation-auto-forward';
