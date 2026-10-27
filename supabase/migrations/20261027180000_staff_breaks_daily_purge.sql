-- Keep only today's KSA staff_breaks rows: purge helper + nightly pg_cron.
-- Never deletes day_key = staff_break_today_ksa(). Touches past days only.

CREATE INDEX IF NOT EXISTS staff_breaks_day_key_idx
  ON public.staff_breaks (day_key);

CREATE OR REPLACE FUNCTION public.purge_old_staff_breaks(
  p_batch_size integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := public.staff_break_today_ksa();
  v_batch integer := GREATEST(1, LEAST(COALESCE(p_batch_size, 2000), 5000));
  v_closed integer := 0;
  v_deleted integer := 0;
  v_pass integer := 0;
  v_total_deleted integer := 0;
  v_today_rows bigint;
  v_active_today bigint;
BEGIN
  -- Close yesterday's leftover open sessions first (does not touch today).
  SELECT public.close_stale_staff_breaks() INTO v_closed;

  -- Delete past days only, in bounded batches (max ~25 passes per call).
  -- Belt: doomed set AND final WHERE both require day_key < today.
  LOOP
    EXIT WHEN v_pass >= 25;

    WITH doomed AS (
      SELECT id
      FROM public.staff_breaks
      WHERE day_key < v_today
      ORDER BY day_key, id
      LIMIT v_batch
    )
    DELETE FROM public.staff_breaks sb
    USING doomed d
    WHERE sb.id = d.id
      AND sb.day_key < v_today;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_deleted;
    v_pass := v_pass + 1;
    EXIT WHEN v_deleted < v_batch;
  END LOOP;

  SELECT count(*) INTO v_today_rows
  FROM public.staff_breaks
  WHERE day_key = v_today;

  SELECT count(*) INTO v_active_today
  FROM public.staff_breaks
  WHERE day_key = v_today AND status = 'active';

  RETURN jsonb_build_object(
    'ok', true,
    'today', v_today,
    'stale_closed', COALESCE(v_closed, 0),
    'deleted', v_total_deleted,
    'passes', v_pass,
    'today_rows', v_today_rows,
    'active_today', v_active_today
  );
END;
$function$;

COMMENT ON FUNCTION public.purge_old_staff_breaks(integer) IS
  'Deletes staff_breaks with day_key older than Asia/Riyadh today. Never deletes today. Batched.';

REVOKE ALL ON FUNCTION public.purge_old_staff_breaks(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_staff_breaks(integer) TO service_role;

-- Nightly at ~00:05 Asia/Riyadh (UTC+3, no DST currently) => 21:05 UTC
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
