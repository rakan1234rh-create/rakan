-- إصلاح 404/42883 عند رد المشرف (sup → aud)
-- السبب: users.role من نوع user_role (enum) مقارنة مع text[] في athar_notif_emit_role
-- الخطأ: operator does not exist: user_role = text

create or replace function public.athar_notif_emit_role(
  p_roles text[],
  p_violation_id uuid,
  p_event_suffix text,
  p_title text,
  p_message text,
  p_type text default 'blue',
  p_icon text default 'fa-bell',
  p_is_auto boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  for v_uid in
    select u.id from public.users u
    where u.role::text = any(p_roles)
      and coalesce(u.is_active, true)
  loop
    perform public.athar_notif_emit(
      v_uid, p_event_suffix, p_violation_id, p_title, p_message,
      p_type, p_icon, 'mine', p_is_auto
    );
  end loop;
end;
$$;
