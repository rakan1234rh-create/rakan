-- SQL to set up the Weekly Digest Cron Job in Supabase (production)
-- Recipients are restricted in Edge Function to: auditor, manager, hr only.
--
-- 1. Ensure pg_net + pg_cron are enabled
-- 2. Set AUTO_FORWARD_CRON_SECRET in Edge Function secrets
-- 3. Schedule Sunday 09:00 (server TZ) — replace PROJECT_REF and CRON_SECRET

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Example (do NOT commit real secrets):
-- SELECT cron.unschedule('violation-weekly-digest');
-- SELECT cron.schedule(
--   'violation-weekly-digest',
--   '0 9 * * 0',
--   $$
--   SELECT net.http_post(
--     url := 'https://PROJECT_REF.supabase.co/functions/v1/violation-push',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', 'CRON_SECRET'
--     ),
--     body := jsonb_build_object('weeklyDigest', true)
--   );
--   $$
-- );
