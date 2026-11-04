-- Auto-forward after the supervisor timeout must land on the Management stage
-- (mgt, «بانتظار القرار الإداري»), not on Internal Control (aud). The app and
-- the edge cron both use the order emp -> sup -> mgt -> aud (hr retired);
-- the DB helper athar_next_workflow_state() is not defined in this repo's
-- migrations and apparently still follows the old order (sup -> aud -> mgt).
--
-- BEFORE APPLYING, check the current definition:
--   select pg_get_functiondef(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'athar_next_workflow_state';
--
-- This migration keeps the existing signature (argument name + return type),
-- honours platform stage skips through the existing
-- public.athar_workflow_stage_skipped(text), and aborts if the signature is
-- not what is expected.
DO $mig$
DECLARE
  v_args text;
  v_ret  text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    INTO v_args, v_ret
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'athar_next_workflow_state'
  LIMIT 1;

  IF v_args IS NULL THEN
    RAISE NOTICE 'athar_next_workflow_state not found - nothing changed';
    RETURN;
  END IF;

  IF v_args NOT LIKE '% text' AND v_args <> 'text' THEN
    RAISE EXCEPTION 'unexpected signature (%) - review manually', v_args;
  END IF;

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.athar_next_workflow_state(%1$s)
    RETURNS %2$s
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $body$
    DECLARE
      v_order text[] := ARRAY['emp', 'sup', 'mgt', 'aud'];
      v_idx int;
      v_i int;
      v_next text;
    BEGIN
      v_idx := array_position(v_order, $1::text);
      IF v_idx IS NULL THEN
        RETURN NULL;
      END IF;
      FOR v_i IN (v_idx + 1)..array_length(v_order, 1) LOOP
        IF NOT public.athar_workflow_stage_skipped(v_order[v_i]) THEN
          v_next := v_order[v_i];
          RETURN v_next::%2$s;
        END IF;
      END LOOP;
      RETURN NULL; -- caller treats NULL as 'closed'
    END;
    $body$
  $f$, v_args, v_ret);
END
$mig$;
