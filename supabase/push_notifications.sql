-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — إشعارات الجوال (Web Push) خارج التطبيق
-- شغّل في Supabase → SQL Editor (بعد rls_session_helpers.sql)
-- ثم اتبع supabase/PUSH-NOTIFICATIONS-SETUP.txt
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- للدالة violation-push (service role) — قراءة اشتراكات المستلمين
drop policy if exists push_subscriptions_service on public.push_subscriptions;
create policy push_subscriptions_service on public.push_subscriptions
  for select to service_role
  using (true);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
