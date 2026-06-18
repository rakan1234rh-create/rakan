-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — نشرات Push (تحفيزية / تنبيهية / تعاميم) — admin فقط للإرسال
-- شغّل في Supabase → SQL Editor (بعد rls_session_helpers.sql و push_notifications.sql)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users(id) on delete restrict,
  title text not null,
  body text not null,
  kind text not null default 'circular'
    check (kind in ('motivational', 'alert', 'circular')),
  target_mode text not null
    check (target_mode in ('all', 'roles', 'branches', 'users')),
  target_roles text[] not null default '{}',
  target_branch_ids uuid[] not null default '{}',
  target_user_ids uuid[] not null default '{}',
  recipient_count int not null default 0,
  push_sent_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_inbox (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  body text,
  kind text check (kind is null or kind in ('motivational', 'alert', 'circular')),
  created_at timestamptz not null default now(),
  constraint broadcast_inbox_broadcast_user_key unique (broadcast_id, user_id)
);

alter table public.broadcast_inbox
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists kind text;

update public.broadcast_inbox bi
set
  title = coalesce(bi.title, b.title),
  body = coalesce(bi.body, b.body),
  kind = coalesce(bi.kind, b.kind)
from public.broadcasts b
where bi.broadcast_id = b.id
  and (bi.kind is null or bi.title is null or bi.body is null);

create index if not exists broadcasts_created_at_idx
  on public.broadcasts (created_at desc);

create index if not exists broadcast_inbox_user_id_idx
  on public.broadcast_inbox (user_id, created_at desc);

alter table public.broadcasts enable row level security;
alter table public.broadcast_inbox enable row level security;

drop policy if exists broadcasts_admin_select on public.broadcasts;
create policy broadcasts_admin_select on public.broadcasts
  for select to authenticated
  using (public.current_user_role() = 'admin' and public.current_user_is_active());

drop policy if exists broadcasts_recipient_select on public.broadcasts;
create policy broadcasts_recipient_select on public.broadcasts
  for select to authenticated
  using (
    public.current_user_is_active()
    and exists (
      select 1
      from public.broadcast_inbox bi
      where bi.broadcast_id = broadcasts.id
        and bi.user_id = public.current_user_id()
    )
  );

drop policy if exists broadcast_inbox_own_select on public.broadcast_inbox;
create policy broadcast_inbox_own_select on public.broadcast_inbox
  for select to authenticated
  using (user_id = public.current_user_id());

grant select on public.broadcasts to authenticated;
grant select on public.broadcast_inbox to authenticated;
grant all on public.broadcasts to service_role;
grant all on public.broadcast_inbox to service_role;

-- عند تعطيل المستخدم: شغّل supabase/cleanup-user-notifications-on-deactivate.sql
