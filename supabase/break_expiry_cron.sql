-- SQL to set up break-expiry Web Push cron (production)
-- Notifies employees via Web Push when active break planned duration elapses.
--
-- 1. Ensure pg_net + pg_cron are enabled
-- 2. Set AUTO_FORWARD_CRON_SECRET in Edge Function secrets (same as auto-forward / weekly digest)
-- 3. Schedule every minute — replace PROJECT_REF and CRON_SECRET

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Example (do NOT commit real secrets):
-- SELECT cron.unschedule('staff-break-expiry-push');
-- SELECT cron.schedule(
--   'staff-break-expiry-push',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://PROJECT_REF.supabase.co/functions/v1/violation-push',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-secret', 'CRON_SECRET'
--     ),
--     body := jsonb_build_object('breakExpiryCron', true)
--   );
--   $$
-- );
