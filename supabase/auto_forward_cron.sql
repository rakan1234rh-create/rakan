-- Auto-forward cron (production) — SAFE path (no anon RPC)
-- ========================================================
--
-- Engine:
--   1) Triggers write due times + rows into violation_forward_jobs
--   2) athar_schedule_forward_job_at() tries one-shot cron.schedule per job
--   3) Minute sweeper: SELECT public.athar_auto_forward_tick();
--
-- Security:
--   Do NOT GRANT EXECUTE on athar_auto_forward_tick / athar_execute_forward_job
--   to anon or authenticated. pg_cron runs as a privileged DB role.
--
-- Optional Edge backup (needs AUTO_FORWARD_CRON_SECRET in Edge secrets):
--   SELECT cron.schedule(
--     'athar-auto-forward-edge',
--     '* * * * *',
--     $$
--     SELECT net.http_post(
--       url := 'https://PROJECT_REF.supabase.co/functions/v1/violation-push',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', 'CRON_SECRET'
--       ),
--       body := jsonb_build_object('autoForwardCron', true)
--     );
--     $$
--   );

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'athar-auto-forward-tick';

SELECT cron.schedule(
  'athar-auto-forward-tick',
  '* * * * *',
  $$SELECT public.athar_auto_forward_tick();$$
);
