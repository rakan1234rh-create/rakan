-- one push subscription per device (see applied migration push_subscriptions_one_per_device)
alter table public.push_subscriptions add column if not exists device_id text;
create unique index if not exists push_subscriptions_user_device_uniq on public.push_subscriptions (user_id, device_id) where device_id is not null;
create or replace function public.athar_push_sub_one_per_device()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.device_id is not null and NEW.device_id <> '' then
    delete from public.push_subscriptions where user_id = NEW.user_id and device_id = NEW.device_id and endpoint <> NEW.endpoint;
  end if;
  delete from public.push_subscriptions where user_id = NEW.user_id and endpoint <> NEW.endpoint and (device_id is null or device_id = '') and coalesce(user_agent,'') = coalesce(NEW.user_agent,'');
  return NEW;
end $$;
revoke all on function public.athar_push_sub_one_per_device() from public, anon, authenticated;
drop trigger if exists athar_push_sub_one_per_device_trg on public.push_subscriptions;
create trigger athar_push_sub_one_per_device_trg after insert or update of endpoint on public.push_subscriptions for each row execute function public.athar_push_sub_one_per_device();
