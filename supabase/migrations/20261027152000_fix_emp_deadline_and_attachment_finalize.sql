-- Fix two production gaps:
-- 1) emp_forward_after is never set because tickets are INSERTed with state=emp
--    while athar_violations_forward_before only ran on UPDATE.
-- 2) Minute cron tick no longer called the overdue sweeper (function body drifted),
--    so tickets without forward-jobs stayed stuck past their SLA with UI at 00:00:00.
-- 3) Attachment finalize/repair blocked the original observer after 15 minutes and
--    never allowed observer self-repair, leaving temp_ paths stranded.

BEGIN;

-- ─── 1) Set deadlines on INSERT and on transition into emp/sup ───────────────
CREATE OR REPLACE FUNCTION public.athar_violations_forward_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sup_start timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF new.state = 'emp' AND new.emp_forward_after IS NULL THEN
      new.emp_forward_after := coalesce(new.created_at, now()) + interval '24 hours';
    END IF;
    IF new.state = 'sup'
       AND NOT public.athar_workflow_stage_skipped('sup')
       AND new.sup_forward_after IS NULL THEN
      new.sup_forward_after := coalesce(new.created_at, now()) + interval '48 hours';
    END IF;
    RETURN new;
  END IF;

  IF TG_OP = 'UPDATE' AND new.state IS DISTINCT FROM old.state THEN
    IF old.state = 'emp' AND new.state <> 'emp' THEN
      new.emp_forward_after := null;
    END IF;

    -- Cover uploading → emp and any other entry into emp.
    IF new.state = 'emp' AND old.state <> 'emp' AND new.emp_forward_after IS NULL THEN
      new.emp_forward_after := now() + interval '24 hours';
    END IF;

    IF new.state = 'sup' AND old.state <> 'sup' THEN
      v_sup_start := now();
      new.sup_forward_after := v_sup_start + interval '48 hours';
    ELSIF old.state = 'sup' AND new.state <> 'sup' THEN
      new.sup_forward_after := null;
    END IF;
  END IF;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS athar_violations_forward_before_trg ON public.violations;
CREATE TRIGGER athar_violations_forward_before_trg
  BEFORE INSERT OR UPDATE ON public.violations
  FOR EACH ROW
  EXECUTE FUNCTION public.athar_violations_forward_before();

-- Also enqueue on INSERT (previously AFTER UPDATE only).
CREATE OR REPLACE FUNCTION public.athar_violations_forward_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF new.state = 'emp'
     AND coalesce(new.auto_forwarded_emp, false) = false
     AND new.emp_forward_after IS NOT NULL THEN
    PERFORM public.athar_enqueue_forward_job(new.id, 'emp_to_sup', new.emp_forward_after);
  END IF;

  IF TG_OP = 'UPDATE' AND old.state = 'emp' AND new.state <> 'emp' THEN
    PERFORM public.athar_cancel_forward_jobs(new.id, 'emp_to_sup');
  END IF;

  IF new.state = 'sup'
     AND NOT public.athar_workflow_stage_skipped('sup')
     AND coalesce(new.auto_forwarded_sup, false) = false
     AND new.sup_forward_after IS NOT NULL THEN
    PERFORM public.athar_enqueue_forward_job(new.id, 'sup_to_aud', new.sup_forward_after);
  END IF;

  IF TG_OP = 'UPDATE' AND old.state = 'sup' AND new.state <> 'sup' THEN
    PERFORM public.athar_cancel_forward_jobs(new.id, 'sup_to_aud');
  END IF;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS athar_violations_forward_after_trg ON public.violations;
CREATE TRIGGER athar_violations_forward_after_trg
  AFTER INSERT OR UPDATE ON public.violations
  FOR EACH ROW
  EXECUTE FUNCTION public.athar_violations_forward_after();

-- Backfill open employee tickets that never received a deadline.
-- The AFTER trigger enqueues forward jobs once emp_forward_after is set.
UPDATE public.violations v
SET emp_forward_after = coalesce(v.created_at, now()) + interval '24 hours'
WHERE v.state = 'emp'
  AND coalesce(v.auto_forwarded_emp, false) = false
  AND v.emp_forward_after IS NULL;

-- ─── 2) Restore overdue sweep inside the minute cron tick ───────────────────
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
  SELECT public.athar_auto_forward_overdue_violations() INTO v_sweep;

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

-- ─── 3) Attachment finalize: observer self-repair + no brittle 15m window ───
CREATE OR REPLACE FUNCTION public.athar_attachment_destination_can_modify(
  p_record_type text,
  p_record_id uuid,
  p_from_key text,
  p_to_key text,
  p_operation text,
  p_expected_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_state text;
  v_employee_id uuid;
  v_branch_id uuid;
  v_observer_id uuid;
  v_source_role text;
  v_created_at timestamptz;
  v_attachments jsonb;
  v_complaint_employee_id uuid;
  v_complaint_status text;
  v_privileged boolean := false;
  v_allowed boolean := false;
  v_service boolean := (auth.role() = 'service_role');
BEGIN
  v_privileged := v_service OR v_role = 'admin' OR public.user_has_platform_perm('act_all_tickets');

  IF (NOT v_service AND (auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()))
     OR p_record_id IS NULL
     OR p_record_type NOT IN ('violation', 'complaint')
     OR p_operation NOT IN ('create', 'reply', 'repair')
     OR (NOT v_privileged AND NOT public.athar_attachment_temp_key_is_owned(p_from_key, auth.uid()))
     OR NOT public.athar_attachment_key_is_canonical(p_to_key, p_record_type, p_record_id)
     OR regexp_replace(p_from_key, '^.*/', '') <> regexp_replace(p_to_key, '^.*/', '') THEN
    RETURN false;
  END IF;

  IF p_record_type = 'violation' THEN
    SELECT v.state::text, v.employee_id, v.branch_id, v.observer_id,
           v.source_role::text, v.created_at, v.attachments
      INTO v_state, v_employee_id, v_branch_id, v_observer_id,
           v_source_role, v_created_at, v_attachments
    FROM public.violations v
    WHERE v.id = p_record_id;
    IF NOT FOUND OR (p_expected_state IS NOT NULL AND v_state <> p_expected_state) THEN
      RETURN false;
    END IF;

    IF p_operation = 'create' THEN
      -- Creator may finish temp→final while the temp key is still referenced.
      -- Drop the brittle 15-minute wall that stranded most recent tickets.
      v_allowed := v_service
        OR (
          v_observer_id = v_uid
          AND v_source_role = v_role
          AND public.athar_attachment_json_has_key(v_attachments, p_from_key)
        );
    ELSIF p_operation = 'reply' THEN
      v_allowed := v_privileged
        OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
        OR (v_state = 'sup' AND v_role = 'supervisor'
            AND v_branch_id = ANY (public.current_user_supervised_branches()))
        OR (v_state = 'aud' AND v_role = 'auditor')
        OR (v_state = 'mgt' AND v_role = 'manager')
        OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
    ELSE
      -- repair: include the original observer so stranded temp_ paths can heal.
      v_allowed := v_privileged
        OR (v_observer_id = v_uid)
        OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
        OR (v_state = 'sup' AND v_role = 'supervisor'
            AND v_branch_id = ANY (public.current_user_supervised_branches()))
        OR (v_state = 'aud' AND v_role = 'auditor')
        OR (v_state = 'mgt' AND v_role = 'manager')
        OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
    END IF;
    RETURN v_allowed;
  END IF;

  SELECT c.employee_id, c.status
    INTO v_complaint_employee_id, v_complaint_status
  FROM public.complaints c
  WHERE c.id = p_record_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_operation = 'create' THEN
    RETURN false;
  END IF;
  RETURN v_privileged OR (v_complaint_status = 'pending' AND v_complaint_employee_id = v_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) TO authenticated, service_role;

COMMIT;
