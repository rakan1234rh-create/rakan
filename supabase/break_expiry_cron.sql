-- SQL to set up break-expiry Web Push cron (production)
-- Notifies employees ONCE when an active break duration is exceeded.
-- Also closes stale (yesterday) open break sessions via close_stale_staff_breaks inside the Edge Function.
--
-- 1. Ensure pg_net + pg_cron are enabled
-- 2. Set AUTO_FORWARD_CRON_SECRET in Edge Function secrets (same as auto-forward / weekly digest)
-- 3. Schedule every minute to detect expiry quickly; the Edge Function marks expiry_notified_at after one attempt

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
