-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — جدولة التمرير التلقائي للمخالفات (بدون متصفح مفتوح)
-- شغّل مرة واحدة في Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- المتطلبات:
-- 1) نشر Edge Function: violation-auto-forward
-- 2) Edge Functions → Secrets → AUTO_FORWARD_CRON_SECRET = نص سري طويل
-- 3) استبدل YOUR_CRON_SECRET_HERE بالقيمة نفسها أدناه
--
-- التحقق:
-- GET https://rizoafuxmqsddjfhbsmf.supabase.co/functions/v1/violation-auto-forward
-- POST يدوي (اختبار):
--   curl -X POST .../violation-auto-forward -H "x-cron-secret: YOUR_SECRET"

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- إزالة الجدولة القديمة إن وُجدت
select cron.unschedule(jobid)
from cron.job
where jobname = 'athar-violation-auto-forward';

-- التمرير يعمل كل دقيقة (أقصى تأخير ~60 ثانية بعد انتهاء المهلة)
select cron.schedule(
  'athar-violation-auto-forward',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rizoafuxmqsddjfhbsmf.supabase.co/functions/v1/violation-auto-forward',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET_HERE'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- تحقق من الجدولة:
-- select jobid, jobname, schedule, command from cron.job where jobname = 'athar-violation-auto-forward';
