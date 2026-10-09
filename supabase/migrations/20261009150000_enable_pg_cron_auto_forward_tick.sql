-- Restore server-side auto-forward without re-opening SECURITY DEFINER RPCs to anon.
-- Root cause: athar_schedule_forward_job_at uses cron.schedule(), but pg_cron was not
-- enabled, so due jobs stayed pending. Client countdown is UI-only backup.
--
-- Security: KEEP athar_auto_forward_tick / athar_execute_forward_job EXECUTE
-- revoked from PUBLIC/anon/authenticated. Only postgres (pg_cron) + service_role.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Minute sweeper: processes due rows in violation_forward_jobs
DO $$
BEGIN
  PERFORM cron.unschedule('athar-auto-forward-tick');
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'athar-auto-forward-tick',
  '* * * * *',
  $$SELECT public.athar_auto_forward_tick();$$
);

-- Harden grants again (idempotent) — never grant tick to anon/authenticated
REVOKE ALL ON FUNCTION public.athar_auto_forward_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_auto_forward_tick() TO service_role;

REVOKE ALL ON FUNCTION public.athar_execute_forward_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_execute_forward_job(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.auto_forward_violations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_forward_violations() TO service_role;
