-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — التمرير يعتمد due_at المجدول + إصلاح استدعاء violation-push
-- شغّل في Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.mirsad_execute_forward_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j public.violation_forward_jobs%rowtype;
  v_res jsonb;
begin
  select * into j from public.violation_forward_jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  if j.cron_job_name is not null then
    perform public.mirsad_unschedule_forward_cron(j.cron_job_name);
  end if;

  if j.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', j.status);
  end if;

  if j.due_at > now() then
    perform public.mirsad_schedule_forward_job_at(p_job_id);
    return jsonb_build_object('ok', false, 'reason', 'rescheduled_early', 'due_at', j.due_at);
  end if;

  select public.mirsad_auto_forward_single(j.violation_id, j.direction, j.due_at) into v_res;

  if coalesce((v_res->>'forwarded')::boolean, false) then
    update public.violation_forward_jobs set status = 'done', processed_at = now() where id = p_job_id;
  elsif coalesce((v_res->>'skipped')::boolean, false) then
    update public.violation_forward_jobs set status = 'skipped', processed_at = now() where id = p_job_id;
  end if;

  return coalesce(v_res, jsonb_build_object('ok', false, 'reason', 'empty_result'));
end;
$$;

create or replace function public.mirsad_auto_forward_single(
  p_violation_id uuid,
  p_direction text,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.violations%rowtype;
  v_new_state text;
  v_action text;
  v_note text;
  v_log jsonb;
  v_logs jsonb;
  v_label text;
  v_started timestamptz;
  v_due timestamptz;
  v_service_key text;
  v_base_url text;
  v_expected_state text;
begin
  select * into r from public.violations where id = p_violation_id for update;
  if not found then
    return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_found');
  end if;

  if p_direction = 'emp_to_sup' then
    v_expected_state := 'emp';
    if r.state <> 'emp' or coalesce(r.auto_forwarded_emp, false) then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'state_mismatch');
    end if;
    v_due := coalesce(p_due_at, r.emp_forward_after, r.created_at + interval '24 hours');
    if v_due > now() then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_due', 'due_at', v_due);
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(r.logs, '[]'::jsonb)) e
      where (e->>'action') ~* 'تمرير تلقائي.*(المشرف|بانتظار رد المشرف)'
    ) then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'already_logged');
    end if;
    v_new_state := public.mirsad_next_workflow_state('emp');
    v_note := 'تم تمرير التذكرة تلقائياً بعد انتهاء مهلة 24 ساعة دون رد من الموظف';
  elsif p_direction = 'sup_to_aud' then
    if public.mirsad_workflow_stage_skipped('sup') then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'stage_skipped');
    end if;
    v_expected_state := 'sup';
    if r.state <> 'sup' or coalesce(r.auto_forwarded_sup, false) then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'state_mismatch');
    end if;
    v_due := coalesce(p_due_at, r.sup_forward_after);
    if v_due is not null then
      if v_due > now() then
        return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_due', 'due_at', v_due);
      end if;
    else
      v_started := public.mirsad_sup_stage_start_time(r.logs, r.auto_forwarded_emp, r.updated_at, r.created_at);
      if v_started is null or v_started > now() - interval '48 hours' then
        return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_due');
      end if;
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(r.logs, '[]'::jsonb)) e
      where (e->>'action') ~* 'تمرير تلقائي.*(المدقق|بانتظار رد المدقق)'
    ) then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'already_logged');
    end if;
    v_new_state := public.mirsad_next_workflow_state('sup');
    v_note := 'تم تمرير التذكرة تلقائياً بعد انتهاء مهلة 48 ساعة دون رد من المشرف';
  else
    return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'bad_direction');
  end if;

  select case v_new_state
    when 'sup' then 'بانتظار رد المشرف'
    when 'aud' then 'بانتظار التدقيق'
    when 'mgt' then 'بانتظار القرار الإداري'
    when 'hr' then 'بانتظار الموارد البشرية'
    when 'closed' then 'مغلقة'
    else v_new_state
  end into v_label;

  v_action := '⚠️ تمرير تلقائي — ' || v_label;
  v_log := jsonb_build_object(
    'date', public.mirsad_now_ksa_text(),
    'user', 'النظام',
    'role', 'النظام',
    'action', v_action,
    'note', v_note
  );
  v_logs := coalesce(r.logs, '[]'::jsonb) || v_log;

  if p_direction = 'emp_to_sup' then
    update public.violations
    set state = v_new_state::public.violation_state,
        logs = v_logs,
        auto_forwarded_emp = true,
        emp_forward_after = null,
        updated_at = now()
    where id = r.id and state = 'emp' and coalesce(auto_forwarded_emp, false) = false;
  else
    update public.violations
    set state = v_new_state::public.violation_state,
        logs = v_logs,
        auto_forwarded_sup = true,
        sup_forward_after = null,
        updated_at = now()
    where id = r.id and state = 'sup' and coalesce(auto_forwarded_sup, false) = false;
  end if;

  if not found then
    return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'race');
  end if;

  perform public.mirsad_cancel_forward_jobs(r.id, p_direction);

  select value into v_service_key from public.mirsad_secrets where key = 'service_role_key';
  select value into v_base_url from public.mirsad_secrets where key = 'supabase_url';

  if v_service_key is not null and v_base_url is not null then
    perform net.http_post(
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
          'auto_forwarded_emp', (p_direction = 'emp_to_sup') or r.auto_forwarded_emp,
          'auto_forwarded_sup', (p_direction = 'sup_to_aud') or r.auto_forwarded_sup
        )
      ),
      timeout_milliseconds := 25000
    );
  end if;

  return jsonb_build_object('forwarded', true, 'new_state', v_new_state);
end;
$$;

grant execute on function public.mirsad_auto_forward_single(uuid, text, timestamptz) to postgres;
