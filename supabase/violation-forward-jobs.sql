-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — تمرير تلقائي عند الموعد فقط (جدول jobs + pg_cron عند due_at)
-- شغّل بعد mirsad-auto-forward-sql.sql
-- ثم: violation-forward-schedule-at-due.sql (للترقية) أو violation-auto-forward-cron.sql
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ─── مواعيد التمرير (للواجهة + للجدولة) ───
alter table public.violations
  add column if not exists emp_forward_after timestamptz,
  add column if not exists sup_forward_after timestamptz;

comment on column public.violations.emp_forward_after is 'موعد التمرير التلقائي من emp (يُحسب عند دخول المرحلة)';
comment on column public.violations.sup_forward_after is 'موعد التمرير التلقائي من sup (يُحسب عند دخول المرحلة)';

-- ─── طابور التمرير — يُنشأ عند تغيير المرحلة فقط ───
create table if not exists public.violation_forward_jobs (
  id uuid primary key default gen_random_uuid(),
  violation_id uuid not null references public.violations(id) on delete cascade,
  direction text not null check (direction in ('emp_to_sup', 'sup_to_aud')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled', 'skipped')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  cron_job_name text
);

comment on column public.violation_forward_jobs.cron_job_name is
  'اسم مهمة pg_cron المجدولة عند due_at';

create index if not exists violation_forward_jobs_due_pending_idx
  on public.violation_forward_jobs (due_at)
  where status = 'pending';

create unique index if not exists violation_forward_jobs_pending_uniq
  on public.violation_forward_jobs (violation_id, direction)
  where status = 'pending';

alter table public.violation_forward_jobs enable row level security;

-- ─── اسم مهمة cron فريد لكل job ───
create or replace function public.mirsad_forward_cron_job_name(p_job_id uuid)
returns text
language sql
immutable
as $$
  select 'athar-fwd-' || replace(p_job_id::text, '-', '');
$$;

-- ─── إلغاء مهمة cron ───
create or replace function public.mirsad_unschedule_forward_cron(p_cron_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_cron_name is null or length(trim(p_cron_name)) = 0 then
    return;
  end if;
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = p_cron_name;
exception when others then null;
end;
$$;

-- ─── تنفيذ job واحد عند الموعد ───
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

  select public.mirsad_auto_forward_single(j.violation_id, j.direction) into v_res;

  if coalesce((v_res->>'forwarded')::boolean, false) then
    update public.violation_forward_jobs set status = 'done', processed_at = now() where id = p_job_id;
  elsif coalesce((v_res->>'skipped')::boolean, false) then
    update public.violation_forward_jobs set status = 'skipped', processed_at = now() where id = p_job_id;
  end if;

  return coalesce(v_res, jsonb_build_object('ok', false, 'reason', 'empty_result'));
end;
$$;

-- ─── جدولة pg_cron عند due_at ───
create or replace function public.mirsad_schedule_forward_job_at(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j public.violation_forward_jobs%rowtype;
  v_cron_name text;
  v_fire_at timestamptz;
  v_fire_utc timestamp;
  v_schedule text;
  v_cmd text;
begin
  select * into j from public.violation_forward_jobs where id = p_job_id;
  if not found or j.status <> 'pending' or j.due_at is null then return; end if;

  v_cron_name := public.mirsad_forward_cron_job_name(p_job_id);
  perform public.mirsad_unschedule_forward_cron(v_cron_name);
  update public.violation_forward_jobs set cron_job_name = v_cron_name where id = p_job_id;

  v_fire_at := date_trunc('minute', j.due_at);
  if j.due_at > v_fire_at then v_fire_at := v_fire_at + interval '1 minute'; end if;

  if v_fire_at <= now() then
    perform public.mirsad_execute_forward_job(p_job_id);
    return;
  end if;

  v_fire_utc := timezone('UTC', v_fire_at);
  v_schedule := format('%s %s %s %s *',
    extract(minute from v_fire_utc)::int, extract(hour from v_fire_utc)::int,
    extract(day from v_fire_utc)::int, extract(month from v_fire_utc)::int);
  v_cmd := format(
    $cmd$select public.mirsad_execute_forward_job(%L::uuid); select cron.unschedule(jobid) from cron.job where jobname = %L;$cmd$,
    p_job_id, v_cron_name);
  perform cron.schedule(v_cron_name, v_schedule, v_cmd);
exception when others then null;
end;
$$;

-- ─── إلغاء jobs معلّقة + cron ───
create or replace function public.mirsad_cancel_forward_jobs(
  p_violation_id uuid,
  p_direction text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j record;
begin
  for j in
    select id, cron_job_name from public.violation_forward_jobs
    where violation_id = p_violation_id and status = 'pending'
      and (p_direction is null or direction = p_direction)
  loop
    if j.cron_job_name is not null then
      perform public.mirsad_unschedule_forward_cron(j.cron_job_name);
    end if;
  end loop;

  update public.violation_forward_jobs
  set status = 'cancelled', processed_at = now(), cron_job_name = null
  where violation_id = p_violation_id and status = 'pending'
    and (p_direction is null or direction = p_direction);
end;
$$;

-- ─── إنشاء job + جدولة عند due_at ───
create or replace function public.mirsad_enqueue_forward_job(
  p_violation_id uuid,
  p_direction text,
  p_due_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
begin
  if p_due_at is null then return; end if;
  perform public.mirsad_cancel_forward_jobs(p_violation_id, p_direction);
  insert into public.violation_forward_jobs (violation_id, direction, due_at, status)
  values (p_violation_id, p_direction, p_due_at, 'pending')
  returning id into v_job_id;
  perform public.mirsad_schedule_forward_job_at(v_job_id);
end;
$$;

-- ─── BEFORE: احسب forward_after عند تغيير المرحلة ───
create or replace function public.mirsad_violations_forward_before()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sup_start timestamptz;
begin
  if tg_op = 'INSERT' and new.state = 'emp' then
    new.emp_forward_after := coalesce(new.created_at, now()) + interval '24 hours';
  end if;

  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    if old.state = 'emp' and new.state <> 'emp' then
      new.emp_forward_after := null;
    end if;

    if new.state = 'sup' and old.state <> 'sup' then
      v_sup_start := now();
      new.sup_forward_after := v_sup_start + interval '48 hours';
    elsif old.state = 'sup' and new.state <> 'sup' then
      new.sup_forward_after := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists mirsad_violations_forward_before_trg on public.violations;
create trigger mirsad_violations_forward_before_trg
  before insert or update of state, auto_forwarded_emp, auto_forwarded_sup
  on public.violations
  for each row
  execute function public.mirsad_violations_forward_before();

-- ─── AFTER: أنشئ/ألغِ jobs ───
create or replace function public.mirsad_violations_forward_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state = 'emp'
     and coalesce(new.auto_forwarded_emp, false) = false
     and new.emp_forward_after is not null then
    perform public.mirsad_enqueue_forward_job(new.id, 'emp_to_sup', new.emp_forward_after);
  end if;

  if tg_op = 'UPDATE' and old.state = 'emp' and new.state <> 'emp' then
    perform public.mirsad_cancel_forward_jobs(new.id, 'emp_to_sup');
  end if;

  if new.state = 'sup'
     and not public.mirsad_workflow_stage_skipped('sup')
     and coalesce(new.auto_forwarded_sup, false) = false
     and new.sup_forward_after is not null then
    perform public.mirsad_enqueue_forward_job(new.id, 'sup_to_aud', new.sup_forward_after);
  end if;

  if tg_op = 'UPDATE' and old.state = 'sup' and new.state <> 'sup' then
    perform public.mirsad_cancel_forward_jobs(new.id, 'sup_to_aud');
  end if;

  return new;
end;
$$;

drop trigger if exists mirsad_violations_forward_after_trg on public.violations;
create trigger mirsad_violations_forward_after_trg
  after insert or update of state, emp_forward_after, sup_forward_after, auto_forwarded_emp, auto_forwarded_sup
  on public.violations
  for each row
  execute function public.mirsad_violations_forward_after();

-- ─── معالجة jobs المستحقة فقط (طلب تمرير عند الموعد) ───
create or replace function public.mirsad_process_forward_jobs(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j record;
  v_res jsonb;
  v_total int := 0;
  v_forwarded int := 0;
  v_skipped int := 0;
begin
  for j in
    select id, violation_id, direction
    from public.violation_forward_jobs
    where status = 'pending'
      and due_at <= now()
    order by due_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    v_total := v_total + 1;

    select public.mirsad_auto_forward_single(j.violation_id, j.direction) into v_res;

    if coalesce((v_res->>'forwarded')::boolean, false) then
      update public.violation_forward_jobs
      set status = 'done', processed_at = now()
      where id = j.id;
      v_forwarded := v_forwarded + 1;
    elsif coalesce((v_res->>'skipped')::boolean, false) then
      update public.violation_forward_jobs
      set status = 'skipped', processed_at = now()
      where id = j.id;
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'engine', 'forward_jobs',
    'processed', v_total,
    'forwarded', v_forwarded,
    'skipped', v_skipped,
    'ran_at', now()
  );
end;
$$;

-- ─── تمرير مخالفة واحدة (يُستدعى من job أو الواجهة) ───
create or replace function public.mirsad_auto_forward_single(
  p_violation_id uuid,
  p_direction text
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
  v_service_key text;
  v_base_url text;
  v_flag_col text;
  v_expected_state text;
begin
  select * into r from public.violations where id = p_violation_id for update;
  if not found then
    return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_found');
  end if;

  if p_direction = 'emp_to_sup' then
    v_flag_col := 'auto_forwarded_emp';
    v_expected_state := 'emp';
    if r.state <> 'emp' or coalesce(r.auto_forwarded_emp, false) then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'state_mismatch');
    end if;
    if r.created_at > now() - interval '24 hours' then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_due');
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
    v_flag_col := 'auto_forwarded_sup';
    v_expected_state := 'sup';
    if r.state <> 'sup' or coalesce(r.auto_forwarded_sup, false) then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'state_mismatch');
    end if;
    v_started := public.mirsad_sup_stage_start_time(r.logs, r.auto_forwarded_emp, r.updated_at, r.created_at);
    if v_started is null or v_started > now() - interval '48 hours' then
      return jsonb_build_object('forwarded', false, 'skipped', true, 'reason', 'not_due');
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

  perform public.mirsad_cancel_forward_jobs(r.id, null);

  select value into v_service_key from public.mirsad_secrets where key = 'service_role_key';
  select value into v_base_url from public.mirsad_secrets where key = 'supabase_url';

  if v_service_key is not null and v_base_url is not null then
    perform net.http_post(
      url := v_base_url || '/functions/v1/violation-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
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

-- ─── احتياط يومي: jobs عالقة فقط ───
create or replace function public.mirsad_auto_forward_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j record;
  v_res jsonb;
  v_total int := 0;
  v_forwarded int := 0;
  v_skipped int := 0;
  v_rescheduled int := 0;
begin
  for j in
    select id from public.violation_forward_jobs
    where status = 'pending' and due_at <= now()
    order by due_at limit 50
  loop
    v_total := v_total + 1;
    select public.mirsad_execute_forward_job(j.id) into v_res;
    if coalesce((v_res->>'forwarded')::boolean, false) then v_forwarded := v_forwarded + 1;
    elsif coalesce((v_res->>'skipped')::boolean, false) then v_skipped := v_skipped + 1;
    elsif v_res->>'reason' = 'rescheduled_early' then v_rescheduled := v_rescheduled + 1;
    end if;
  end loop;

  for j in
    select id from public.violation_forward_jobs
    where status = 'pending' and due_at > now() and cron_job_name is null
    limit 50
  loop
    perform public.mirsad_schedule_forward_job_at(j.id);
    v_rescheduled := v_rescheduled + 1;
  end loop;

  return jsonb_build_object('ok', true, 'engine', 'forward_jobs_scheduled',
    'processed', v_total, 'forwarded', v_forwarded, 'skipped', v_skipped,
    'rescheduled', v_rescheduled, 'ran_at', now());
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm, 'ran_at', now());
end;
$$;

grant execute on function public.mirsad_process_forward_jobs(int) to postgres;
grant execute on function public.mirsad_auto_forward_single(uuid, text) to postgres;
grant execute on function public.mirsad_forward_cron_job_name(uuid) to postgres;
grant execute on function public.mirsad_unschedule_forward_cron(text) to postgres;
grant execute on function public.mirsad_execute_forward_job(uuid) to postgres;
grant execute on function public.mirsad_schedule_forward_job_at(uuid) to postgres;

-- ─── ترحيل مخالفات قائمة ───
update public.violations v
set emp_forward_after = v.created_at + interval '24 hours'
where v.state = 'emp'
  and coalesce(v.auto_forwarded_emp, false) = false
  and v.emp_forward_after is null;

update public.violations v
set sup_forward_after = public.mirsad_sup_stage_start_time(v.logs, v.auto_forwarded_emp, v.updated_at, v.created_at) + interval '48 hours'
where v.state = 'sup'
  and coalesce(v.auto_forwarded_sup, false) = false
  and not public.mirsad_workflow_stage_skipped('sup')
  and v.sup_forward_after is null
  and public.mirsad_sup_stage_start_time(v.logs, v.auto_forwarded_emp, v.updated_at, v.created_at) is not null;

insert into public.violation_forward_jobs (violation_id, direction, due_at, status)
select v.id, 'emp_to_sup', v.emp_forward_after, 'pending'
from public.violations v
where v.state = 'emp'
  and coalesce(v.auto_forwarded_emp, false) = false
  and v.emp_forward_after is not null
  and not exists (
    select 1 from public.violation_forward_jobs j
    where j.violation_id = v.id and j.direction = 'emp_to_sup' and j.status = 'pending'
  );

insert into public.violation_forward_jobs (violation_id, direction, due_at, status)
select v.id, 'sup_to_aud', v.sup_forward_after, 'pending'
from public.violations v
where v.state = 'sup'
  and coalesce(v.auto_forwarded_sup, false) = false
  and v.sup_forward_after is not null
  and not public.mirsad_workflow_stage_skipped('sup')
  and not exists (
    select 1 from public.violation_forward_jobs j
    where j.violation_id = v.id and j.direction = 'sup_to_aud' and j.status = 'pending'
  );

-- جدولة cron لكل job معلّق
do $$
declare j record;
begin
  for j in select id from public.violation_forward_jobs where status = 'pending'
  loop
    perform public.mirsad_schedule_forward_job_at(j.id);
  end loop;
end;
$$;

-- اختبار:
-- select public.mirsad_execute_forward_job('<job-uuid>');
