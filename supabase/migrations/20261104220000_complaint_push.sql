-- إشعار جهاز (Push) لإشعارات الشكاوى/الاقتراحات: كلما أُنشئ/تجدد إشعار cmpl* نرسل push للمستخدم
create or replace function public.athar_complaint_notif_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'net', 'extensions'
as $function$
declare
  anon_key text;
  push_secret text;
begin
  begin
    if NEW.event_key is null or NEW.event_key !~ '^cmpl(_new_|r_|s_)' then return NEW; end if;
    if TG_OP = 'UPDATE' and not (
      (coalesce(NEW.is_read, false) = false and coalesce(OLD.is_read, false) = true)
      or NEW.created_at is distinct from OLD.created_at
      or NEW.message is distinct from OLD.message
    ) then return NEW; end if;
    if coalesce(NEW.is_read, false) then return NEW; end if;

    select trim(value) into anon_key from public.athar_secrets where key = 'anon_key' limit 1;
    select trim(value) into push_secret from public.athar_secrets where key = 'violation_push_webhook_secret' limit 1;
    if anon_key is null or length(anon_key) < 20 or push_secret is null or length(push_secret) < 20 then
      return NEW;
    end if;

    perform net.http_post(
      url := 'https://cmdkldxbocbpiptdodmp.supabase.co/functions/v1/violation-push',
      body := jsonb_build_object('complaintPush', true, 'userId', NEW.user_id, 'title', NEW.title,
                                 'message', NEW.message, 'eventKey', NEW.event_key),
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key, 'apikey', anon_key, 'x-athar-push-secret', push_secret)
    );
  exception when others then
    raise warning 'athar_complaint_notif_push failed: %', sqlerrm;
  end;
  return NEW;
end;
$function$;

drop trigger if exists athar_complaint_notif_push_trg on public.notifications;
create trigger athar_complaint_notif_push_trg
  after insert or update on public.notifications
  for each row execute function public.athar_complaint_notif_push();
