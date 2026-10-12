-- Security RPC hardening (audit section 1)
--
-- Internal mutation/forwarding/queue/backfill RPCs are never browser endpoints.
-- The only browser-facing mutation endpoint in this group remains
-- append_violation_log_with_guard(), which validates an active authenticated
-- user, role, ticket ownership/scope, and the expected workflow state.
--
-- pg_cron runs the minute sweeper as postgres. Keep postgres and service_role
-- executable on internal functions; remove PUBLIC/anon/authenticated instead.

BEGIN;

-- A SECURITY DEFINER ACL is the primary boundary. This is a second boundary
-- for functions that must never be reached from PostgREST. Supabase versions
-- have used both a legacy role GUC and the JSON claims GUC, so inspect both
-- independently. pg_cron has neither request GUC and remains trusted.
CREATE OR REPLACE FUNCTION public.athar_assert_internal_invocation(
  p_allow_trigger boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_legacy_role text := NULLIF(current_setting('request.jwt.claim.role', true), '');
  v_claims_raw text := NULLIF(current_setting('request.jwt.claims', true), '');
  v_claims_role text;
BEGIN
  IF v_claims_raw IS NOT NULL THEN
    BEGIN
      v_claims_role := v_claims_raw::jsonb ->> 'role';
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid request JWT claims on internal service function'
        USING ERRCODE = '42501';
    END;
  END IF;

  IF COALESCE(v_legacy_role, '') IN ('anon', 'authenticated')
     OR COALESCE(v_claims_role, '') IN ('anon', 'authenticated') THEN
    -- Queue admission is invoked by an AFTER trigger during a valid browser
    -- transition, so permit only that nested trigger path, never direct RPC.
    IF NOT p_allow_trigger OR pg_trigger_depth() = 0 THEN
      RAISE EXCEPTION 'internal service function is not a browser endpoint'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$function$;

-- Legacy append RPC: retain the service contract for trusted server work only,
-- but fail closed if a PostgREST JWT role ever reaches it after an ACL mistake.
CREATE OR REPLACE FUNCTION public.append_violation_log(
  p_violation_id uuid,
  p_log_entry jsonb,
  p_new_state text DEFAULT NULL,
  p_status_text text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_logs jsonb;
BEGIN
  PERFORM public.athar_assert_internal_invocation();

  IF p_log_entry IS NULL OR jsonb_typeof(p_log_entry) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سجل الإجراء غير صالح');
  END IF;

  IF octet_length(p_log_entry::text) > 16000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سجل الإجراء كبير جداً');
  END IF;

  IF p_status_text IS NOT NULL AND char_length(p_status_text) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نص الحالة طويل جداً');
  END IF;

  SELECT logs INTO v_logs
  FROM public.violations
  WHERE id = p_violation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المخالفة غير موجودة');
  END IF;

  UPDATE public.violations
  SET
    logs = COALESCE(v_logs, '[]'::jsonb) || jsonb_build_array(p_log_entry),
    state = COALESCE(NULLIF(p_new_state, '')::public.violation_state, state),
    status_text = COALESCE(p_status_text, status_text),
    updated_at = now()
  WHERE id = p_violation_id
  RETURNING jsonb_build_object('ok', true, 'id', id, 'logs', logs)
  INTO v_logs;

  RETURN v_logs;
END;
$function$;

-- Queue admission is invoked by athar_violations_forward_after() only. The
-- trigger already calculated emp_forward_after/sup_forward_after on the row.
-- p_due_at remains solely for signature compatibility and is deliberately
-- ignored: a caller cannot bring a due date forward by supplying a past value.
CREATE OR REPLACE FUNCTION public.athar_enqueue_forward_job(
  p_violation_id uuid,
  p_direction text,
  p_due_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job_id uuid;
  v_due_at timestamptz;
  v_state public.violation_state;
  v_already_forwarded boolean;
BEGIN
  -- This function is also reached from athar_violations_forward_after() while
  -- processing a legitimate authenticated response; the helper permits only
  -- that trigger-nested path and still rejects direct browser RPC calls.
  PERFORM public.athar_assert_internal_invocation(true);

  IF p_direction NOT IN ('emp_to_sup', 'sup_to_aud') THEN
    RAISE EXCEPTION 'invalid forward direction' USING ERRCODE = '22023';
  END IF;

  SELECT
    CASE
      WHEN p_direction = 'emp_to_sup' THEN v.emp_forward_after
      ELSE v.sup_forward_after
    END,
    v.state,
    CASE
      WHEN p_direction = 'emp_to_sup' THEN COALESCE(v.auto_forwarded_emp, false)
      ELSE COALESCE(v.auto_forwarded_sup, false)
    END
  INTO v_due_at, v_state, v_already_forwarded
  FROM public.violations AS v
  WHERE v.id = p_violation_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_due_at IS NULL
     OR v_already_forwarded
     OR (p_direction = 'emp_to_sup' AND v_state <> 'emp')
     OR (p_direction = 'sup_to_aud' AND v_state <> 'sup') THEN
    RETURN;
  END IF;

  -- Do not use p_due_at. The ticket row is the canonical, server-calculated source.
  PERFORM public.athar_cancel_forward_jobs(p_violation_id, p_direction);

  INSERT INTO public.violation_forward_jobs (violation_id, direction, due_at, status)
  VALUES (p_violation_id, p_direction, v_due_at, 'pending')
  RETURNING id INTO v_job_id;

  PERFORM public.athar_schedule_forward_job_at(v_job_id);
END;
$function$;

-- Canonical forwarding engine. It reads the deadline that the server-side
-- trigger stored on the violation, never a supplied RPC/queue deadline.
CREATE OR REPLACE FUNCTION public.athar_auto_forward_single_canonical(
  p_violation_id uuid,
  p_direction text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r public.violations%ROWTYPE;
  v_new_state text;
  v_action text;
  v_note text;
  v_log jsonb;
  v_logs jsonb;
  v_label text;
  v_started timestamptz;
  v_due_at timestamptz;
  v_service_key text;
  v_base_url text;
  v_expected_state text;
BEGIN
  PERFORM public.athar_assert_internal_invocation();

  SELECT * INTO r
  FROM public.violations
  WHERE id = p_violation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_found');
  END IF;

  IF p_direction = 'emp_to_sup' THEN
    v_expected_state := 'emp';
    IF r.state <> 'emp' OR COALESCE(r.auto_forwarded_emp, false) THEN
      RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'state_mismatch');
    END IF;

    v_due_at := COALESCE(r.emp_forward_after, r.created_at + interval '24 hours');
    IF v_due_at > now() THEN
      RETURN jsonb_build_object(
        'forwarded', false, 'skipped', true, 'reason', 'not_due', 'due_at', v_due_at
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(r.logs, '[]'::jsonb)) AS e
      WHERE (e->>'action') ~* 'تمرير تلقائي.*(المشرف|بانتظار رد المشرف)'
    ) THEN
      RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'already_logged');
    END IF;

    v_new_state := public.athar_next_workflow_state('emp');
    v_note := 'تم تمرير التذكرة تلقائياً بعد انتهاء مهلة 24 ساعة دون رد من الموظف';
  ELSIF p_direction = 'sup_to_aud' THEN
    IF public.athar_workflow_stage_skipped('sup') THEN
      RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'stage_skipped');
    END IF;

    v_expected_state := 'sup';
    IF r.state <> 'sup' OR COALESCE(r.auto_forwarded_sup, false) THEN
      RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'state_mismatch');
    END IF;

    v_due_at := r.sup_forward_after;
    IF v_due_at IS NULL THEN
      v_started := public.athar_sup_stage_start_time(
        r.logs, r.auto_forwarded_emp, r.updated_at, r.created_at
      );
      IF v_started IS NULL THEN
        RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_due');
      END IF;
      v_due_at := v_started + interval '48 hours';
    END IF;

    IF v_due_at > now() THEN
      RETURN jsonb_build_object(
        'forwarded', false, 'skipped', true, 'reason', 'not_due', 'due_at', v_due_at
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(r.logs, '[]'::jsonb)) AS e
      WHERE (e->>'action') ~* 'تمرير تلقائي.*(المدقق|بانتظار رد المدقق)'
    ) THEN
      RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'already_logged');
    END IF;

    v_new_state := public.athar_next_workflow_state('sup');
    v_note := 'تم تمرير التذكرة تلقائياً بعد انتهاء مهلة 48 ساعة دون رد من المشرف';
  ELSE
    RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'bad_direction');
  END IF;

  SELECT CASE v_new_state
    WHEN 'sup' THEN 'بانتظار رد المشرف'
    WHEN 'aud' THEN 'بانتظار التدقيق'
    WHEN 'mgt' THEN 'بانتظار القرار الإداري'
    WHEN 'hr' THEN 'بانتظار الموارد البشرية'
    WHEN 'closed' THEN 'مغلقة'
    ELSE v_new_state
  END INTO v_label;

  v_action := '⚠️ تمرير تلقائي — ' || v_label;
  v_log := jsonb_build_object(
    'date', public.athar_now_ksa_text(),
    'user', 'النظام',
    'role', 'النظام',
    'action', v_action,
    'note', v_note
  );
  v_logs := COALESCE(r.logs, '[]'::jsonb) || v_log;

  IF p_direction = 'emp_to_sup' THEN
    UPDATE public.violations
    SET state = v_new_state::public.violation_state,
        logs = v_logs,
        auto_forwarded_emp = true,
        emp_forward_after = NULL,
        updated_at = now()
    WHERE id = r.id
      AND state = 'emp'
      AND COALESCE(auto_forwarded_emp, false) = false;
  ELSE
    UPDATE public.violations
    SET state = v_new_state::public.violation_state,
        logs = v_logs,
        auto_forwarded_sup = true,
        sup_forward_after = NULL,
        updated_at = now()
    WHERE id = r.id
      AND state = 'sup'
      AND COALESCE(auto_forwarded_sup, false) = false;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'race');
  END IF;

  PERFORM public.athar_cancel_forward_jobs(r.id, p_direction);

  SELECT value INTO v_service_key
  FROM public.athar_secrets
  WHERE key = 'service_role_key';

  SELECT value INTO v_base_url
  FROM public.athar_secrets
  WHERE key = 'supabase_url';

  IF v_service_key IS NOT NULL AND v_base_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_base_url || '/functions/v1/violation-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key,
        'apikey', v_service_key
      ),
      body := jsonb_build_object(
        'notifyState', true,
        'isAutoForward', true,
        'previousState', v_expected_state,
        'dedupeKey', 'sqljob:' || r.id || ':' || p_direction || ':' || v_new_state,
        'record', jsonb_build_object(
          'id', r.id,
          'ticket_number', r.ticket_number,
          'violation_type', r.violation_type,
          'employee_id', r.employee_id,
          'branch_id', r.branch_id,
          'state', v_new_state,
          'auto_forwarded_emp', (p_direction = 'emp_to_sup') OR r.auto_forwarded_emp,
          'auto_forwarded_sup', (p_direction = 'sup_to_aud') OR r.auto_forwarded_sup
        )
      ),
      timeout_milliseconds := 25000
    );
  END IF;

  RETURN jsonb_build_object('forwarded', true, 'new_state', v_new_state);
END;
$function$;

-- Keep the historical three-argument signature for already-scheduled work,
-- but never trust or consume its p_due_at argument.
-- PostgreSQL cannot remove an existing parameter DEFAULT with CREATE OR
-- REPLACE. Recreate this exact overload without one so the explicit two-arg
-- overload below is never ambiguous to SQL/PostgREST callers.
DROP FUNCTION IF EXISTS public.athar_auto_forward_single(uuid, text, timestamptz);

CREATE OR REPLACE FUNCTION public.athar_auto_forward_single(
  p_violation_id uuid,
  p_direction text,
  p_due_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- p_due_at is intentionally ignored; the canonical engine reads the ticket deadline.
  RETURN public.athar_auto_forward_single_canonical(p_violation_id, p_direction);
END;
$function$;

-- The two-argument compatibility endpoint follows the same canonical path.
-- Keeping this wrapper avoids breaking callers that already use this signature.
CREATE OR REPLACE FUNCTION public.athar_auto_forward_single(
  p_violation_id uuid,
  p_direction text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.athar_auto_forward_single_canonical(p_violation_id, p_direction);
END;
$function$;

-- Execute a queued job through the canonical two-argument engine. If an old
-- queued row carries an early/tampered deadline, restore the deadline returned
-- by the ticket engine and reschedule instead of forwarding prematurely.
CREATE OR REPLACE FUNCTION public.athar_execute_forward_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  j public.violation_forward_jobs%ROWTYPE;
  v_res jsonb;
  v_canonical_due timestamptz;
BEGIN
  PERFORM public.athar_assert_internal_invocation();

  SELECT * INTO j
  FROM public.violation_forward_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;

  IF j.cron_job_name IS NOT NULL THEN
    PERFORM public.athar_unschedule_forward_cron(j.cron_job_name);
  END IF;

  IF j.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', j.status);
  END IF;

  IF j.due_at > now() THEN
    PERFORM public.athar_schedule_forward_job_at(p_job_id);
    RETURN jsonb_build_object('ok', false, 'reason', 'rescheduled_early', 'due_at', j.due_at);
  END IF;

  SELECT public.athar_auto_forward_single_canonical(j.violation_id, j.direction)
  INTO v_res;

  IF v_res->>'reason' = 'not_due' AND v_res ? 'due_at' THEN
    v_canonical_due := (v_res->>'due_at')::timestamptz;
    UPDATE public.violation_forward_jobs
    SET due_at = v_canonical_due,
        cron_job_name = NULL
    WHERE id = p_job_id
      AND status = 'pending';

    PERFORM public.athar_schedule_forward_job_at(p_job_id);
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'rescheduled_canonical_due',
      'due_at', v_canonical_due
    );
  END IF;

  IF COALESCE((v_res->>'forwarded')::boolean, false) THEN
    UPDATE public.violation_forward_jobs
    SET status = 'done', processed_at = now()
    WHERE id = p_job_id;
  ELSIF COALESCE((v_res->>'skipped')::boolean, false) THEN
    UPDATE public.violation_forward_jobs
    SET status = 'skipped', processed_at = now()
    WHERE id = p_job_id;
  END IF;

  RETURN COALESCE(v_res, jsonb_build_object('ok', false, 'reason', 'empty_result'));
END;
$function$;

-- Maintenance backfill is internal too. Retain its bounded behavior, and add
-- a body-level rejection for browser JWT roles as defense in depth.
CREATE OR REPLACE FUNCTION public.athar_backfill_notifications_recent(p_limit integer DEFAULT 120)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_count integer := 0;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 120), 500));
BEGIN
  PERFORM public.athar_assert_internal_invocation();

  PERFORM set_config('athar.notif_backfill', '1', true);
  FOR v_id IN
    SELECT id
    FROM public.violations
    WHERE COALESCE(state::text, '') NOT IN ('uploading', 'draft')
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT v_limit
  LOOP
    UPDATE public.violations
    SET state = state
    WHERE id = v_id;
    v_count := v_count + 1;
  END LOOP;
  PERFORM set_config('athar.notif_backfill', '0', true);

  RETURN v_count;
END;
$function$;

-- Browser-facing RPC: preserve the existing active-account and scope checks,
-- then bind reply field, transition, and reset flags to the current workflow
-- state. This prevents a valid but lower-privilege user from forging a later
-- state in the RPC payload while retaining configurable skipped stages.
CREATE OR REPLACE FUNCTION public.append_violation_log_with_guard(
  p_violation_id uuid,
  p_expected_state text,
  p_log_entry jsonb,
  p_new_state text DEFAULT NULL,
  p_status_text text DEFAULT NULL,
  p_reply_field text DEFAULT NULL,
  p_reply_text text DEFAULT NULL,
  p_attachments jsonb DEFAULT NULL,
  p_reset_auto_forwarded_emp boolean DEFAULT false,
  p_reset_auto_forwarded_sup boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_role text;
  v_allowed boolean := false;
  v_logs jsonb;
  v_atts jsonb;
  v_existing_atts jsonb;
  v_employee_id uuid;
  v_branch_id uuid;
  v_ticket_number text;
  v_expected_attachment_folder text;
  v_next_state text;
  v_allowed_reply text[] := ARRAY[
    'employee_reply',
    'supervisor_reply',
    'audit_reply',
    'management_reply',
    'hr_reply'
  ];
  v_allowed_states text[] := ARRAY[
    'emp', 'sup', 'aud', 'mgt', 'hr', 'closed', 'Warning_Issued', 'uploading'
  ];
BEGIN
  v_uid := public.current_user_id();
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;

  v_role := public.current_user_role();

  IF p_expected_state IS NULL OR p_expected_state = ''
     OR NOT (p_expected_state = ANY (v_allowed_states)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'حالة متوقعة غير صالحة');
  END IF;

  IF p_new_state IS NULL OR p_new_state = ''
     OR NOT (p_new_state = ANY (v_allowed_states)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'حالة جديدة غير صالحة');
  END IF;

  IF p_reply_field IS NOT NULL AND p_reply_field <> ''
     AND NOT (p_reply_field = ANY (v_allowed_reply)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'حقل رد غير صالح');
  END IF;

  IF p_reply_text IS NOT NULL AND char_length(p_reply_text) > 8000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نص الرد طويل جداً');
  END IF;

  IF p_reply_field IS NOT NULL AND p_reply_field <> ''
     AND NULLIF(btrim(p_reply_text), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نص الرد مطلوب');
  END IF;

  IF p_status_text IS NOT NULL AND char_length(p_status_text) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'نص الحالة طويل جداً');
  END IF;

  IF p_log_entry IS NULL OR jsonb_typeof(p_log_entry) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سجل الإجراء غير صالح');
  END IF;

  IF octet_length(p_log_entry::text) > 16000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'سجل الإجراء كبير جداً');
  END IF;

  SELECT employee_id, branch_id, ticket_number, logs, attachments
    INTO v_employee_id, v_branch_id, v_ticket_number, v_logs, v_existing_atts
  FROM public.violations
  WHERE id = p_violation_id
    AND state = p_expected_state::public.violation_state
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'حالة التذكرة تغيّرت بالفعل — يرجى إعادة تحميل الصفحة'
    );
  END IF;

  IF v_role = 'admin'
     OR public.user_has_platform_perm('act_all_tickets') THEN
    v_allowed := true;
  ELSIF p_expected_state = 'emp'
        AND v_role IN ('employee', 'branch_manager')
        AND v_employee_id = v_uid THEN
    v_allowed := true;
  ELSIF p_expected_state = 'sup'
        AND v_role = 'supervisor'
        AND v_branch_id = ANY (public.current_user_supervised_branches()) THEN
    v_allowed := true;
  ELSIF p_expected_state = 'aud' AND v_role = 'auditor' THEN
    v_allowed := true;
  ELSIF p_expected_state = 'mgt' AND v_role = 'manager' THEN
    v_allowed := true;
  ELSIF p_expected_state = 'hr'
        AND (
          v_role = 'hr'
          OR public.user_has_platform_perm('act_as_hr')
          OR (
            -- HR queue auto-close (no reply field): admins/viewers with view_all_tickets
            public.user_has_platform_perm('view_all_tickets')
            AND p_new_state = 'closed'
            AND (p_reply_field IS NULL OR p_reply_field = '')
          )
        ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'غير مصرح بهذا الإجراء');
  END IF;

  -- The configured workflow function is also used by the UI. It permits stage
  -- skipping without allowing a caller to choose an arbitrary later state.
  v_next_state := public.athar_next_workflow_state(p_expected_state);
  IF v_next_state IS NULL OR v_next_state = '' THEN
    v_next_state := 'closed';
  END IF;

  IF p_expected_state = 'emp' THEN
    IF p_reply_field IS DISTINCT FROM 'employee_reply'
       OR NULLIF(btrim(p_reply_text), '') IS NULL
       OR p_new_state IS DISTINCT FROM v_next_state THEN
      RETURN jsonb_build_object('ok', false, 'error', 'انتقال الموظف غير مصرح');
    END IF;
  ELSIF p_expected_state = 'sup' THEN
    IF p_reply_field IS DISTINCT FROM 'supervisor_reply'
       OR NULLIF(btrim(p_reply_text), '') IS NULL
       OR p_new_state IS DISTINCT FROM v_next_state THEN
      RETURN jsonb_build_object('ok', false, 'error', 'انتقال المشرف غير مصرح');
    END IF;
  ELSIF p_expected_state = 'aud' THEN
    IF p_reply_field IS DISTINCT FROM 'audit_reply'
       OR NULLIF(btrim(p_reply_text), '') IS NULL
       OR p_new_state NOT IN (v_next_state, 'closed') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'انتقال التدقيق غير مصرح');
    END IF;
  ELSIF p_expected_state = 'mgt' THEN
    IF p_reply_field IS DISTINCT FROM 'management_reply'
       OR NULLIF(btrim(p_reply_text), '') IS NULL
       OR p_new_state NOT IN (v_next_state, 'closed', 'Warning_Issued') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'انتقال الإدارة غير مصرح');
    END IF;
  ELSIF p_expected_state = 'hr' THEN
    IF (p_reply_field IS NULL OR p_reply_field = '') THEN
      IF p_new_state <> 'closed' OR NOT public.user_has_platform_perm('view_all_tickets') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'إغلاق قائمة الموارد البشرية غير مصرح');
      END IF;
    ELSIF p_reply_field IS DISTINCT FROM 'hr_reply'
          OR NULLIF(btrim(p_reply_text), '') IS NULL
          OR p_new_state NOT IN ('closed', 'Warning_Issued') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'انتقال الموارد البشرية غير مصرح');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'الحالة غير قابلة للرد');
  END IF;

  IF (p_reset_auto_forwarded_emp AND p_expected_state <> 'emp')
     OR (p_reset_auto_forwarded_sup AND p_expected_state <> 'sup') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'إعادة ضبط التمرير غير مصرح');
  END IF;

  v_atts := p_attachments;
  IF v_atts IS NOT NULL AND jsonb_typeof(v_atts) = 'string' THEN
    BEGIN
      v_atts := (v_atts #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'error', 'المرفقات غير صالحة');
    END;
  END IF;

  IF v_atts IS NOT NULL AND jsonb_typeof(v_atts) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'المرفقات غير صالحة');
  END IF;

  IF v_atts IS NOT NULL AND jsonb_array_length(v_atts) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'عدد المرفقات كبير جداً');
  END IF;

  IF v_atts IS NOT NULL AND octet_length(v_atts::text) > 200000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'بيانات المرفقات كبيرة جداً');
  END IF;

  -- A response may append R2 files, but may not use this RPC to discard or
  -- rewrite an existing attachment list. New keys must be in this ticket's
  -- canonical R2 folder; r2-storage separately proves the temp-object owner
  -- and record/state authorization before it moves an object into that folder.
  v_existing_atts := CASE
    WHEN jsonb_typeof(v_existing_atts) = 'array' THEN v_existing_atts
    ELSE '[]'::jsonb
  END;
  v_expected_attachment_folder := 'violations/' || p_violation_id::text;

  IF v_atts IS NOT NULL AND NOT (v_atts @> v_existing_atts) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا يمكن استبدال أو حذف المرفقات الحالية');
  END IF;

  IF v_atts IS NOT NULL AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_atts) AS candidate(value)
    WHERE NOT (v_existing_atts @> jsonb_build_array(candidate.value))
      AND (
        jsonb_typeof(candidate.value) <> 'object'
        OR NULLIF(btrim(COALESCE(candidate.value ->> 'p', candidate.value ->> 'path')), '') IS NULL
        OR (
          candidate.value ? 'p' AND candidate.value ? 'path'
          AND (candidate.value ->> 'p') IS DISTINCT FROM (candidate.value ->> 'path')
        )
        OR COALESCE(candidate.value ->> 'p', candidate.value ->> 'path') !~
             ('^' || v_expected_attachment_folder || '/[A-Za-z0-9_.-]+$')
        OR COALESCE(candidate.value ->> 'p', candidate.value ->> 'path') LIKE '%..%'
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مرجع مرفق جديد غير مصرح');
  END IF;

  UPDATE public.violations
  SET
    logs = COALESCE(v_logs, '[]'::jsonb) || jsonb_build_array(p_log_entry),
    state = p_new_state::public.violation_state,
    status_text = COALESCE(p_status_text, status_text),
    attachments = COALESCE(v_atts, attachments),
    auto_forwarded_emp = CASE WHEN p_reset_auto_forwarded_emp THEN FALSE ELSE auto_forwarded_emp END,
    auto_forwarded_sup = CASE WHEN p_reset_auto_forwarded_sup THEN FALSE ELSE auto_forwarded_sup END,
    updated_at = now()
  WHERE id = p_violation_id
    AND state = p_expected_state::public.violation_state;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'تعارض — تم تحديث التذكرة بالتوازي، يرجى إعادة المحاولة'
    );
  END IF;

  IF p_reply_field IS NOT NULL AND p_reply_field <> '' THEN
    EXECUTE format('UPDATE public.violations SET %I = $1 WHERE id = $2', p_reply_field)
    USING p_reply_text, p_violation_id;
  END IF;

  RETURN (
    SELECT jsonb_build_object('ok', true, 'id', id, 'logs', logs, 'state', state)
    FROM public.violations
    WHERE id = p_violation_id
  );
END;
$function$;

-- Internal service/cron surface. Dynamic lookup covers every installed
-- overload, including legacy deployments, without failing on a missing one.
DO $block$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'athar_assert_internal_invocation',
        'append_violation_log',
        'athar_auto_forward_single',
        'athar_auto_forward_single_canonical',
        'athar_auto_forward_overdue_violations',
        'athar_enqueue_forward_job',
        'athar_process_forward_jobs',
        'athar_backfill_notifications_recent',
        'athar_auto_forward_tick',
        'athar_execute_forward_job',
        'athar_schedule_forward_job_at',
        'athar_cancel_forward_jobs',
        'athar_unschedule_forward_cron',
        'auto_forward_violations',
        'athar_violations_forward_before',
        'athar_violations_forward_after',
        'athar_guard_violations_integrity',
        -- Renamed compatibility wrappers still reach the same cron surface.
        'mirsad_execute_forward_job',
        'mirsad_auto_forward_tick'
      ])
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.signature || ' FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.signature || ' TO postgres, service_role';
  END LOOP;
END;
$block$;

-- Keep the validated browser RPC reachable only to logged-in users. Its body
-- (20261009120000) enforces active-account and workflow/role authorization.
REVOKE ALL ON FUNCTION public.append_violation_log_with_guard(
  uuid, text, jsonb, text, text, text, text, jsonb, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_violation_log_with_guard(
  uuid, text, jsonb, text, text, text, text, jsonb, boolean, boolean
) TO postgres, service_role, authenticated;

COMMIT;
