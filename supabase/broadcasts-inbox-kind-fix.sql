-- إصلاح توزيع النشرات حسب النوع (تعاميم / إنجازات / تنبيهات)
-- شغّل في Supabase → SQL Editor مرة واحدة

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
