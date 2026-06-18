-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — حذف التنبيه من عند المستخدم فقط (لا يؤثر على مدير الفرع/المشرف)
-- شغّل في Supabase → SQL Editor (بعد rls_session_helpers.sql و broadcasts.sql)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.user_notif_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  notif_id text not null,
  dismissed_at timestamptz not null default now(),
  constraint user_notif_dismissals_user_notif_key unique (user_id, notif_id)
);

create index if not exists user_notif_dismissals_user_id_idx
  on public.user_notif_dismissals (user_id);

alter table public.user_notif_dismissals enable row level security;

drop policy if exists user_notif_dismissals_select on public.user_notif_dismissals;
create policy user_notif_dismissals_select on public.user_notif_dismissals
  for select to authenticated
  using (user_id = public.current_user_id());

drop policy if exists user_notif_dismissals_insert on public.user_notif_dismissals;
create policy user_notif_dismissals_insert on public.user_notif_dismissals
  for insert to authenticated
  with check (user_id = public.current_user_id());

drop policy if exists user_notif_dismissals_update on public.user_notif_dismissals;
create policy user_notif_dismissals_update on public.user_notif_dismissals
  for update to authenticated
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

drop policy if exists user_notif_dismissals_delete on public.user_notif_dismissals;
create policy user_notif_dismissals_delete on public.user_notif_dismissals
  for delete to authenticated
  using (user_id = public.current_user_id());

grant select, insert, update, delete on public.user_notif_dismissals to authenticated;
grant all on public.user_notif_dismissals to service_role;

-- نشرات admin: كل مستخدم يحذف صفه فقط من broadcast_inbox
drop policy if exists broadcast_inbox_own_delete on public.broadcast_inbox;
create policy broadcast_inbox_own_delete on public.broadcast_inbox
  for delete to authenticated
  using (user_id = public.current_user_id());

grant delete on public.broadcast_inbox to authenticated;
