-- SQL reference for staff-breaks daily purge (production)
-- Keeps only Asia/Riyadh "today" rows in public.staff_breaks.
-- Schedule: 00:05 Asia/Riyadh ≈ 21:05 UTC (UTC+3, no DST currently).
--
-- Prefer the migration 20261027180000_staff_breaks_daily_purge.sql.
-- Re-run this only to repair the cron job name/schedule.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
BEGIN
  PERFORM cron.unschedule('athar-staff-breaks-daily-purge');
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'athar-staff-breaks-daily-purge',
  '5 21 * * *',
  $$SELECT public.purge_old_staff_breaks(2000);$$
);
