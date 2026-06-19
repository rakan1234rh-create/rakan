-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — Cron التمرير التلقائي
-- ═══════════════════════════════════════════════════════════════════════════
--
-- الطريقة أ (مُفضّلة): service_role في Authorization — الأضمن مع pg_net
-- الطريقة ب: cronSecret في body (يجب أن يطابق AUTO_FORWARD_CRON_SECRET حرفياً)
--
-- قبل التشغيل:
--   1) violation-push إصدار 2026-06-auto-forward-cron-v3
--   2) احذف الجدولة القديمة ثم شغّل أحد الخيارين أدناه فقط

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'athar-violation-auto-forward';

-- ─── الخيار أ: service_role (الأضمن) ───
-- Settings → API → service_role (secret) — انسخه مرة واحدة
-- استبدل YOUR_SERVICE_ROLE_KEY_HERE بالكامل (يبدأ عادة بـ eyJ...)

/*
select cron.schedule(
  'athar-violation-auto-forward',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rizoafuxmqsddjfhbsmf.supabase.co/functions/v1/violation-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY_HERE'
    ),
    body := '{"autoForwardCron":true}'::jsonb
  ) as request_id;
  $$
);
*/

-- ─── الخيار ب: cronSecret في body ───
-- Edge Functions → Secrets → AUTO_FORWARD_CRON_SECRET
-- استخدم أحرف وأرقام فقط (بدون مسافات أو علامة ')

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
-- select jobid,
--   case when command like '%cronSecret%' then 'body secret' when command like '%Authorization%Bearer%' then 'service role' else 'unknown' end as mode,
--   case when command like '%YOUR_%_HERE%' then 'placeholder!' else 'ok' end as placeholder
-- from cron.job where jobname = 'athar-violation-auto-forward';
