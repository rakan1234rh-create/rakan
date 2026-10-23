-- Ensure the minute Cron also sweeps legacy/overdue violations that were
-- created before queue admission or whose queue row is missing.
-- The existing queue processing remains in place for scheduled jobs.
CREATE OR REPLACE FUNCTION public.athar_auto_forward_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  j record;
  v_res jsonb;
  v_sweep jsonb;
  v_total int := 0;
  v_forwarded int := 0;
  v_skipped int := 0;
  v_rescheduled int := 0;
BEGIN
  -- Direct overdue sweep covers rows that have no violation_forward_jobs row.
  -- It is idempotent and uses state/flag guards to avoid double forwarding.
  SELECT public.athar_auto_forward_overdue_violations() INTO v_sweep;

  -- Process due queued jobs created by normal workflow transitions.
  FOR j IN
    SELECT id, due_at, cron_job_name
    FROM public.violation_forward_jobs
    WHERE status = 'pending'
      AND due_at <= now()
    ORDER BY due_at
    LIMIT 50
  LOOP
    v_total := v_total + 1;
    SELECT public.athar_execute_forward_job(j.id) INTO v_res;

    IF COALESCE((v_res->>'forwarded')::boolean, false) THEN
      v_forwarded := v_forwarded + 1;
    ELSIF COALESCE((v_res->>'skipped')::boolean, false) THEN
      v_skipped := v_skipped + 1;
    ELSIF v_res->>'reason' = 'rescheduled_early' THEN
      v_rescheduled := v_rescheduled + 1;
    END IF;
  END LOOP;

  -- Restore scheduling for future pending jobs that lost their cron name.
  FOR j IN
    SELECT id
    FROM public.violation_forward_jobs
    WHERE status = 'pending'
      AND due_at > now()
      AND cron_job_name IS NULL
    LIMIT 50
  LOOP
    PERFORM public.athar_schedule_forward_job_at(j.id);
    v_rescheduled := v_rescheduled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'engine', 'overdue_sweep_and_forward_jobs',
    'overdue_sweep', v_sweep,
    'processed', v_total,
    'forwarded', v_forwarded,
    'skipped', v_skipped,
    'rescheduled', v_rescheduled,
    'ran_at', now()
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', SQLERRM,
    'overdue_sweep', COALESCE(v_sweep, '{}'::jsonb),
    'ran_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.athar_auto_forward_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_auto_forward_tick() TO service_role;
