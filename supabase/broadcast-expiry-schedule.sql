-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — جدولة انتهاء نشرات الجوال وحذفها تلقائياً
-- شغّل في Supabase → SQL Editor (بعد broadcasts.sql و notifications.sql)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.broadcasts
  add column if not exists expires_at timestamptz;

comment on column public.broadcasts.expires_at is
  'موعد حذف النشرة وصناديق الوارد والتنبيهات المرتبطة — بعده يُنظَّف السجل تلقائياً';

create index if not exists broadcasts_expires_at_idx
  on public.broadcasts (expires_at)
  where expires_at is not null;

-- حذف النشرات المنتهية (cascade → broadcast_inbox + notifications.broadcast_id)
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

revoke all on function public.athar_cleanup_expired_broadcasts() from public;
grant execute on function public.athar_cleanup_expired_broadcasts() to service_role;

-- كل دقيقة — حذف النشرات بعد انتهاء الموعد مباشرة (تأخير ≤ 60 ثانية)
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(j.jobid)
from cron.job j
where j.jobname = 'athar-broadcast-expiry-cleanup';

select cron.schedule(
  'athar-broadcast-expiry-cleanup',
  '* * * * *',
  $$ select public.athar_cleanup_expired_broadcasts(); $$
);

-- تحقق:
-- select jobid, jobname, schedule from cron.job where jobname = 'athar-broadcast-expiry-cleanup';
-- select public.athar_cleanup_expired_broadcasts();
