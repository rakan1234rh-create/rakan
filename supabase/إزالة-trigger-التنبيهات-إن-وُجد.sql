-- شغّل مرة واحدة إن كنت قد نفّذت violation-push-trigger.sql سابقاً
-- (التطبيق يرسل التنبيه مباشرة — لا حاجة للـ trigger)

drop trigger if exists athar_violation_push_after_insert on public.violations;
drop function if exists public.athar_violation_push_notify();
