-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — جدولة عند الموعد فقط (بدون polling)
-- • حذف النشرة: pg_cron واحد عند expires_at
-- • التمرير: pg_cron عند due_at فقط (إلغاء الاحتياط اليومي + الكرون القديم)
-- شغّل في Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema pg_catalog;

-- ─── إلغاء كل مهام الـ polling القديمة ───
select cron.unschedule(j.jobid)
from cron.job j
where j.jobname in (
  'athar-broadcast-expiry-cleanup',
  'auto-forward-violations',
  'athar-violation-auto-forward',
  'athar-violation-forward-fallback'
);

alter table public.broadcasts
  add column if not exists expires_at timestamptz,
  add column if not exists expiry_cron_job_name text;

comment on column public.broadcasts.expiry_cron_job_name is
  'اسم مهمة pg_cron لحذف النشرة عند expires_at — تُلغى بعد التنفيذ';

create index if not exists broadcasts_expires_at_idx
  on public.broadcasts (expires_at)
  where expires_at is not null;

-- ─── حذف دفعة (للاستخدام اليدوي/الترحيل فقط) ───
create or replace function public.athar_cleanup_expired_broadcasts()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    select id
    from public.broadcasts
    where expires_at is not null
      and expires_at <= now()
  ),
  removed as (
    delete from public.broadcasts b
    using doomed d
    where b.id = d.id
    returning b.id
  )
  select count(*)::integer into v_deleted from removed;
  return coalesce(v_deleted, 0);
end;
$$;

-- ─── أسماء مهام cron للنشرات ───
create or replace function public.athar_broadcast_cron_job_name(p_broadcast_id uuid)
returns text
language sql
immutable
as $$
  select 'athar-bc-exp-' || replace(p_broadcast_id::text, '-', '');
$$;

create or replace function public.athar_unschedule_broadcast_cron(p_cron_name text)
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

-- ─── حذف نشرة واحدة عند الموعد ───
create or replace function public.athar_execute_broadcast_expiry(p_broadcast_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.broadcasts%rowtype;
begin
  select * into b from public.broadcasts where id = p_broadcast_id;
  if not found then
    return;
  end if;

  if b.expiry_cron_job_name is not null then
    perform public.athar_unschedule_broadcast_cron(b.expiry_cron_job_name);
  end if;

  if b.expires_at is null then
    update public.broadcasts set expiry_cron_job_name = null where id = p_broadcast_id;
    return;
  end if;

  if b.expires_at > now() then
    perform public.athar_schedule_broadcast_expiry_at(p_broadcast_id);
    return;
  end if;

  delete from public.broadcasts where id = p_broadcast_id;
end;
$$;

-- ─── جدولة حذف نشرة عند expires_at ───
create or replace function public.athar_schedule_broadcast_expiry_at(p_broadcast_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.broadcasts%rowtype;
  v_cron_name text;
  v_fire_at timestamptz;
  v_fire_utc timestamp;
  v_schedule text;
  v_cmd text;
begin
  select * into b from public.broadcasts where id = p_broadcast_id;
  if not found then return; end if;

  v_cron_name := public.athar_broadcast_cron_job_name(p_broadcast_id);

  if b.expiry_cron_job_name is not null and b.expiry_cron_job_name <> v_cron_name then
    perform public.athar_unschedule_broadcast_cron(b.expiry_cron_job_name);
  end if;

  if b.expires_at is null then
    if b.expiry_cron_job_name is not null then
      perform public.athar_unschedule_broadcast_cron(b.expiry_cron_job_name);
    end if;
    update public.broadcasts set expiry_cron_job_name = null where id = p_broadcast_id;
    return;
  end if;

  update public.broadcasts
  set expiry_cron_job_name = v_cron_name
  where id = p_broadcast_id;

  v_fire_at := date_trunc('minute', b.expires_at);
  if b.expires_at > v_fire_at then
    v_fire_at := v_fire_at + interval '1 minute';
  end if;

  if v_fire_at <= now() then
    perform public.athar_execute_broadcast_expiry(p_broadcast_id);
    return;
  end if;

  perform public.athar_unschedule_broadcast_cron(v_cron_name);

  v_fire_utc := timezone('UTC', v_fire_at);
  v_schedule := format(
    '%s %s %s %s *',
    extract(minute from v_fire_utc)::int,
    extract(hour from v_fire_utc)::int,
    extract(day from v_fire_utc)::int,
    extract(month from v_fire_utc)::int
  );
  v_cmd := format(
    $cmd$select public.athar_execute_broadcast_expiry(%L::uuid); select cron.unschedule(jobid) from cron.job where jobname = %L;$cmd$,
    p_broadcast_id,
    v_cron_name
  );
  perform cron.schedule(v_cron_name, v_schedule, v_cmd);
exception when others then null;
end;
$$;

-- ─── trigger: جدولة تلقائية عند الإرسال أو تغيير expires_at ───
create or replace function public.athar_broadcast_expiry_trg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.expiry_cron_job_name is not null then
      perform public.athar_unschedule_broadcast_cron(old.expiry_cron_job_name);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public.athar_schedule_broadcast_expiry_at(new.id);
  elsif new.expires_at is distinct from old.expires_at then
    perform public.athar_schedule_broadcast_expiry_at(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists athar_broadcast_expiry_schedule_trg on public.broadcasts;
create trigger athar_broadcast_expiry_schedule_trg
  after insert or update of expires_at
  on public.broadcasts
  for each row
  execute function public.athar_broadcast_expiry_trg();

drop trigger if exists athar_broadcast_expiry_delete_trg on public.broadcasts;
create trigger athar_broadcast_expiry_delete_trg
  before delete
  on public.broadcasts
  for each row
  execute function public.athar_broadcast_expiry_trg();

revoke all on function public.athar_cleanup_expired_broadcasts() from public;
grant execute on function public.athar_cleanup_expired_broadcasts() to service_role;
grant execute on function public.athar_broadcast_cron_job_name(uuid) to postgres, service_role;
grant execute on function public.athar_unschedule_broadcast_cron(text) to postgres, service_role;
grant execute on function public.athar_execute_broadcast_expiry(uuid) to postgres, service_role;
grant execute on function public.athar_schedule_broadcast_expiry_at(uuid) to postgres, service_role;

-- ─── جدولة النشرات الحالية ذات expires_at مستقبلي ───
do $$
declare
  r record;
begin
  for r in
    select id
    from public.broadcasts
    where expires_at is not null
      and expires_at > now()
  loop
    perform public.athar_schedule_broadcast_expiry_at(r.id);
  end loop;
end;
$$;

-- ─── إعادة جدولة jobs تمرير معلّقة بلا cron ───
do $$
declare
  j record;
begin
  for j in
    select id
    from public.violation_forward_jobs
    where status = 'pending'
      and due_at is not null
      and (cron_job_name is null or cron_job_name = '')
  loop
    perform public.mirsad_schedule_forward_job_at(j.id);
  end loop;
end;
$$;

-- تحقق:
-- select jobname, schedule, left(command, 100) from cron.job where jobname like 'athar-%' order by jobname;
-- select id, expires_at, expiry_cron_job_name from broadcasts where expires_at is not null order by expires_at desc limit 10;
