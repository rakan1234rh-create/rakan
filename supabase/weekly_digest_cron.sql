-- SQL to set up the Weekly Digest Cron Job in Supabase
-- This uses pg_net extension which is standard in Supabase for calling Edge Functions

-- 1. Ensure pg_net is enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Create the cron job
-- Schedule: Every Sunday at 09:00 AM (0 9 * * 0)
-- Replace YOUR_PROJECT_REF with your actual project reference
-- Replace YOUR_CRON_SECRET with the value of AUTO_FORWARD_CRON_SECRET from your Edge Function secrets

SELECT cron.schedule(
  'violation-weekly-digest',
  '0 9 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/violation-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object('weeklyDigest', true)
  )
  $$
);

-- Note: You can find your Project Ref in Supabase Project Settings -> General
-- You can find/set AUTO_FORWARD_CRON_SECRET in Supabase Project Settings -> Edge Functions -> Secrets
