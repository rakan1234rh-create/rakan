-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — حذف تنبيهات الموظف عند التعطيل (is_active = false)
-- شغّل مرة واحدة في Supabase → SQL Editor
-- (بعد push_notifications.sql و broadcasts.sql)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.athar_cleanup_user_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.is_active = false and coalesce(OLD.is_active, true) = true then
    delete from public.push_subscriptions where user_id = NEW.id;
    delete from public.broadcast_inbox where user_id = NEW.id;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'notifications'
        and column_name = 'user_id'
    ) then
      delete from public.notifications where user_id = NEW.id;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists athar_user_deactivate_cleanup on public.users;
create trigger athar_user_deactivate_cleanup
  after update of is_active on public.users
  for each row
  execute function public.athar_cleanup_user_notifications();

-- تنظيف لمرة واحدة: مستخدمون معطّلون سابقاً
delete from public.push_subscriptions ps
using public.users u
where ps.user_id = u.id and u.is_active = false;

delete from public.broadcast_inbox bi
using public.users u
where bi.user_id = u.id and u.is_active = false;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'user_id'
  ) then
    execute $sql$
      delete from public.notifications n
      using public.users u
      where n.user_id = u.id and u.is_active = false
    $sql$;
  end if;
end $$;
