-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — جدولة التمرير عند الموعد بالضبط (بدل فحص كل 10 دقائق)
-- شغّل بعد: mirsad-auto-forward-sql.sql + violation-forward-jobs.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- السلوك الجديد:
--   • عند إنشاء job → pg_cron واحد يُشغَّل عند due_at (دقة الدقيقة)
--   • التمرير + violation-push يحدثان فقط عند التنفيذ
--   • احتياط يومي خفيف للـ jobs العالقة (مرة واحدة/يوم)
--   • يُلغى cron كل 10 دقائق القديم

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.violation_forward_jobs
  add column if not exists cron_job_name text;

comment on column public.violation_forward_jobs.cron_job_name is
  'اسم مهمة pg_cron المجدولة عند due_at — يُلغى بعد التنفيذ أو الإلغاء';

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
exception
  when undefined_table then
    null;
  when others then
    null;
end;
$$;

-- ─── تنفيذ job واحد (يُستدعى من pg_cron عند الموعد) ───
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
  select * into j
  from public.violation_forward_jobs
  where id = p_job_id;

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
    update public.violation_forward_jobs
    set status = 'done', processed_at = now()
    where id = p_job_id;
  elsif coalesce((v_res->>'skipped')::boolean, false) then
    update public.violation_forward_jobs
    set status = 'skipped', processed_at = now()
    where id = p_job_id;
  end if;

  return coalesce(v_res, jsonb_build_object('ok', false, 'reason', 'empty_result'));
end;
$$;

-- ─── جدولة pg_cron عند due_at (أو تنفيذ فوري إن فات الموعد) ───
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
  select * into j
  from public.violation_forward_jobs
  where id = p_job_id;

  if not found or j.status <> 'pending' or j.due_at is null then
    return;
  end if;

  v_cron_name := public.mirsad_forward_cron_job_name(p_job_id);
  perform public.mirsad_unschedule_forward_cron(v_cron_name);

  update public.violation_forward_jobs
  set cron_job_name = v_cron_name
  where id = p_job_id;

  -- أول دقيقة >= due_at (تجنّب التنفيذ قبل انتهاء المهلة بثوانٍ)
  v_fire_at := date_trunc('minute', j.due_at);
  if j.due_at > v_fire_at then
    v_fire_at := v_fire_at + interval '1 minute';
  end if;

  if v_fire_at <= now() then
    perform public.mirsad_execute_forward_job(p_job_id);
    return;
  end if;

  v_fire_utc := timezone('UTC', v_fire_at);
  v_schedule := format(
    '%s %s %s %s *',
    extract(minute from v_fire_utc)::int,
    extract(hour from v_fire_utc)::int,
    extract(day from v_fire_utc)::int,
    extract(month from v_fire_utc)::int
  );

  v_cmd := format(
    $cmd$select public.mirsad_execute_forward_job(%L::uuid); select cron.unschedule(jobid) from cron.job where jobname = %L;$cmd$,
    p_job_id,
    v_cron_name
  );

  perform cron.schedule(v_cron_name, v_schedule, v_cmd);
exception
  when others then
    -- إن فشلت الجدولة، يبقى الاحتياط اليومي يلتقط الـ job العالق
    null;
end;
$$;

-- ─── إلغاء jobs + cron المرتبطة ───
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
    select id, cron_job_name
    from public.violation_forward_jobs
    where violation_id = p_violation_id
      and status = 'pending'
      and (p_direction is null or direction = p_direction)
  loop
    if j.cron_job_name is not null then
      perform public.mirsad_unschedule_forward_cron(j.cron_job_name);
    end if;
  end loop;

  update public.violation_forward_jobs
  set status = 'cancelled',
      processed_at = now(),
      cron_job_name = null
  where violation_id = p_violation_id
    and status = 'pending'
    and (p_direction is null or direction = p_direction);
end;
$$;

-- ─── إنشاء job + جدولة فورية عند due_at ───
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
  if p_due_at is null then
    return;
  end if;

  perform public.mirsad_cancel_forward_jobs(p_violation_id, p_direction);

  insert into public.violation_forward_jobs (violation_id, direction, due_at, status)
  values (p_violation_id, p_direction, p_due_at, 'pending')
  returning id into v_job_id;

  perform public.mirsad_schedule_forward_job_at(v_job_id);
end;
$$;

-- ─── احتياط يومي: jobs عالقة فقط (ليس فحصاً دورياً لكل المخالفات) ───
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
    select id, due_at, cron_job_name
    from public.violation_forward_jobs
    where status = 'pending'
      and due_at <= now()
    order by due_at
    limit 50
  loop
    v_total := v_total + 1;
    select public.mirsad_execute_forward_job(j.id) into v_res;

    if coalesce((v_res->>'forwarded')::boolean, false) then
      v_forwarded := v_forwarded + 1;
    elsif coalesce((v_res->>'skipped')::boolean, false) then
      v_skipped := v_skipped + 1;
    elsif v_res->>'reason' = 'rescheduled_early' then
      v_rescheduled := v_rescheduled + 1;
    end if;
  end loop;

  -- jobs مستقبلية بلا cron (بعد ترقية أو فشل جدولة)
  for j in
    select id
    from public.violation_forward_jobs
    where status = 'pending'
      and due_at > now()
      and cron_job_name is null
    limit 50
  loop
    perform public.mirsad_schedule_forward_job_at(j.id);
    v_rescheduled := v_rescheduled + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'engine', 'forward_jobs_scheduled',
    'processed', v_total,
    'forwarded', v_forwarded,
    'skipped', v_skipped,
    'rescheduled', v_rescheduled,
    'ran_at', now()
  );
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm, 'ran_at', now());
end;
$$;

grant execute on function public.mirsad_forward_cron_job_name(uuid) to postgres;
grant execute on function public.mirsad_unschedule_forward_cron(text) to postgres;
grant execute on function public.mirsad_execute_forward_job(uuid) to postgres;
grant execute on function public.mirsad_schedule_forward_job_at(uuid) to postgres;

-- ─── إلغاء cron polling / احتياط يومي (التمرير عند due_at فقط) ───
select cron.unschedule(j.jobid)
from cron.job j
where j.jobname in (
  'athar-violation-auto-forward',
  'athar-violation-forward-fallback',
  'auto-forward-violations'
);

-- ─── جدولة jobs معلّقة حالياً ───
do $$
declare
  j record;
begin
  for j in
    select id
    from public.violation_forward_jobs
    where status = 'pending'
  loop
    perform public.mirsad_schedule_forward_job_at(j.id);
  end loop;
end;
$$;

-- تحقق:
-- select jobname, schedule, left(command, 100) from cron.job where jobname like 'athar-fwd-%' or jobname = 'athar-violation-forward-fallback';
-- select id, violation_id, direction, due_at, cron_job_name, status from violation_forward_jobs where status = 'pending' order by due_at limit 20;
