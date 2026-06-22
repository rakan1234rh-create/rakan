-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — جدول التنبيهات الحقيقي (Supabase)
-- شغّل في Supabase → SQL Editor (بعد rls_session_helpers.sql)
-- يوسّع الجدول notifications الموجود ويضيف triggers + RPC
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) توسيع الجدول ───
alter table public.notifications
  add column if not exists title text,
  add column if not exists icon text default 'fa-bell',
  add column if not exists scope text default 'mine',
  add column if not exists event_key text,
  add column if not exists broadcast_id uuid references public.broadcasts(id) on delete cascade,
  add column if not exists broadcast_kind text,
  add column if not exists is_auto boolean not null default false,
  add column if not exists dismissed_at timestamptz;

-- type = لون الواجهة (amber|blue|red|green|purple|orange) — message = نص التنبيه
update public.notifications
set title = coalesce(title, left(message, 120), 'تنبيه')
where title is null;

create unique index if not exists notifications_user_event_key_uidx
  on public.notifications (user_id, event_key)
  where event_key is not null and user_id is not null;

create index if not exists notifications_user_active_idx
  on public.notifications (user_id, created_at desc)
  where dismissed_at is null;

-- ─── 2) RPC: إدراج/تحديث تنبيه (idempotent) ───
create or replace function public.athar_upsert_notification(
  p_user_id uuid,
  p_event_key text,
  p_title text,
  p_message text,
  p_type text default 'amber',
  p_icon text default 'fa-bell',
  p_ticket_id uuid default null,
  p_scope text default 'mine',
  p_is_auto boolean default false,
  p_broadcast_id uuid default null,
  p_broadcast_kind text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or coalesce(trim(p_event_key), '') = '' then
    return null;
  end if;

  insert into public.notifications (
    user_id, event_key, title, message, type, icon,
    ticket_id, scope, is_auto, broadcast_id, broadcast_kind,
    is_read, dismissed_at, created_at
  )
  values (
    p_user_id, trim(p_event_key), coalesce(nullif(trim(p_title), ''), 'تنبيه'),
    coalesce(p_message, ''), coalesce(nullif(trim(p_type), ''), 'amber'),
    coalesce(nullif(trim(p_icon), ''), 'fa-bell'),
    p_ticket_id, coalesce(nullif(trim(p_scope), ''), 'mine'),
    coalesce(p_is_auto, false), p_broadcast_id, p_broadcast_kind,
    false, null, now()
  )
  on conflict (user_id, event_key)
  where event_key is not null and user_id is not null
  do update set
    title = excluded.title,
    message = excluded.message,
    type = excluded.type,
    icon = excluded.icon,
    ticket_id = excluded.ticket_id,
    scope = excluded.scope,
    is_auto = excluded.is_auto,
    broadcast_id = excluded.broadcast_id,
    broadcast_kind = excluded.broadcast_kind,
    dismissed_at = null,
    created_at = greatest(public.notifications.created_at, excluded.created_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.athar_upsert_notification(uuid, text, text, text, text, text, uuid, text, boolean, uuid, text) from public;
grant execute on function public.athar_upsert_notification(uuid, text, text, text, text, text, uuid, text, boolean, uuid, text) to service_role;

-- ─── 3) مساعدات التذاكر ───
create or replace function public.athar_short_ticket_num(p_ticket_number text)
returns text
language sql
immutable
as $$
  select case
    when p_ticket_number is null or trim(p_ticket_number) = '' then '—'
    when array_length(string_to_array(trim(p_ticket_number), '-'), 1) >= 3
      then (string_to_array(trim(p_ticket_number), '-'))[array_length(string_to_array(trim(p_ticket_number), '-'), 1)]
    else trim(p_ticket_number)
  end;
$$;

create or replace function public.athar_region_supervisor_id(p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.supervisor_id
  from public.branches b
  join public.regions r on r.id = b.region_id
  where b.id = p_branch_id
  limit 1;
$$;

-- ─── 4) تنبيهات عند إنشاء مخالفة ───
create or replace function public.athar_notify_violation_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket text;
  v_emp_name text;
  v_team_body text;
  v_uid uuid;
  v_is_emp boolean;
  v_is_bm boolean;
  v_title text;
  v_msg text;
begin
  if NEW.state = 'uploading' then
    return NEW;
  end if;

  v_ticket := public.athar_short_ticket_num(NEW.ticket_number);

  if NEW.employee_id is not null then
    select coalesce(u.name, '') into v_emp_name
    from public.users u where u.id = NEW.employee_id;
  end if;

  v_team_body := case
    when coalesce(v_emp_name, '') <> '' then v_emp_name || ' — تذكرة ' || v_ticket
    else 'تذكرة ' || v_ticket
  end;

  if NEW.employee_id is not null then
    perform public.athar_upsert_notification(
      NEW.employee_id, 'violation_new_' || NEW.id::text,
      'تم تسجيل مخالفة بحقك', 'تذكرة ' || v_ticket,
      'amber', 'fa-bell', NEW.id, 'mine', false, null, null
    );
    perform public.athar_upsert_notification(
      NEW.employee_id, 'pending_' || NEW.id::text,
      'مخالفة بانتظار ردك',
      coalesce(NEW.violation_type, '') || ' — ' || v_ticket,
      'amber', 'fa-bell', NEW.id, 'mine', false, null, null
    );
  end if;

  if NEW.branch_id is not null then
    for v_uid in
      select u.id from public.users u
      where u.branch_id = NEW.branch_id
        and u.role = 'branch_manager'
        and coalesce(u.is_active, true)
        and (NEW.employee_id is null or u.id <> NEW.employee_id)
    loop
      v_is_emp := false;
      v_is_bm := true;
      v_title := 'تم تسجيل مخالفة على موظف ضمن فريقك';
      v_msg := v_team_body;
      perform public.athar_upsert_notification(
        v_uid, 'bm_team_pending_' || NEW.id::text,
        v_title, v_msg, 'amber', 'fa-clipboard-list', NEW.id, 'team', false, null, null
      );
    end loop;

    v_uid := public.athar_region_supervisor_id(NEW.branch_id);
    if v_uid is not null and (NEW.employee_id is null or v_uid <> NEW.employee_id) then
      perform public.athar_upsert_notification(
        v_uid, 'violation_new_' || NEW.id::text,
        'مخالفة جديدة في فريقك', v_team_body,
        'blue', 'fa-bell', NEW.id, 'team', false, null, null
      );
    end if;
  end if;

  return NEW;
end;
$$;

-- ─── 5) تنبيهات عند تغيّر مرحلة التذكرة ───
create or replace function public.athar_notify_violation_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket text;
  v_emp_name text;
  v_body text;
  v_uid uuid;
  v_state text;
  v_title text;
  v_type text;
  v_icon text;
  v_scope text;
  v_event text;
  v_is_auto boolean;
  v_st text;
  v_is_warn boolean;
  v_is_penalty boolean;
  v_is_cancelled boolean;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;
  if current_setting('athar.notif_backfill', true) is distinct from '1'
     and NEW.state is not distinct from OLD.state
     and NEW.status_text is not distinct from OLD.status_text then
    return NEW;
  end if;

  v_state := coalesce(NEW.state::text, '');
  v_ticket := public.athar_short_ticket_num(NEW.ticket_number);

  if NEW.employee_id is not null then
    select coalesce(u.name, '') into v_emp_name
    from public.users u where u.id = NEW.employee_id;
  end if;

  v_body := case
    when coalesce(v_emp_name, '') <> '' then v_emp_name || ' — تذكرة ' || v_ticket
    else 'تذكرة ' || v_ticket
  end;

  v_is_auto := coalesce(NEW.auto_forwarded_emp, false) and v_state = 'sup'
    or coalesce(NEW.auto_forwarded_sup, false) and v_state = 'aud';

  -- إزالة تنبيه «بانتظار المعالجة» القديم للموظف عند الانتقال
  if NEW.employee_id is not null and v_state <> 'emp' then
    update public.notifications
    set dismissed_at = now()
    where user_id = NEW.employee_id
      and event_key = 'pending_' || NEW.id::text
      and dismissed_at is null;
  end if;

  -- تنبيهات «بانتظار المعالجة» حسب المرحلة
  if v_state not in ('uploading', 'closed', 'Warning_Issued') then
  if v_state = 'emp' and NEW.employee_id is not null then
    perform public.athar_upsert_notification(
      NEW.employee_id, 'pending_' || NEW.id::text,
      'مخالفة بانتظار ردك',
      coalesce(NEW.violation_type, '') || ' — ' || v_ticket,
      'amber', 'fa-bell', NEW.id, 'mine', v_is_auto, null, null
    );
  elsif v_state = 'sup' then
    v_uid := coalesce(NEW.supervisor_id, public.athar_region_supervisor_id(NEW.branch_id));
    if v_uid is not null then
      v_title := case when v_is_auto then 'مخالفة بانتظار رد المشرف (تمرير تلقائي)' else 'مخالفة بانتظار رد المشرف' end;
      perform public.athar_upsert_notification(
        v_uid, 'pending_' || NEW.id::text, v_title, v_body,
        case when v_is_auto then 'amber' else 'blue' end,
        case when v_is_auto then 'fa-robot' else 'fa-bell' end,
        NEW.id, 'mine', v_is_auto, null, null
      );
    end if;
  elsif v_state = 'aud' then
    for v_uid in select u.id from public.users u where u.role in ('auditor', 'admin') and coalesce(u.is_active, true)
    loop
      v_title := case when v_is_auto then 'تذكرة بانتظار التدقيق (تمرير تلقائي)' else 'تذكرة بانتظار التدقيق' end;
      perform public.athar_upsert_notification(
        v_uid, 'pending_' || NEW.id::text, v_title, v_body,
        'purple', case when v_is_auto then 'fa-robot' else 'fa-bell' end,
        NEW.id, 'mine', v_is_auto, null, null
      );
    end loop;
  elsif v_state = 'mgt' then
    for v_uid in select u.id from public.users u where u.role in ('manager', 'admin') and coalesce(u.is_active, true)
    loop
      perform public.athar_upsert_notification(
        v_uid, 'pending_' || NEW.id::text,
        'قرار إداري مطلوب', v_body, 'red', 'fa-bell', NEW.id, 'mine', false, null, null
      );
    end loop;
  elsif v_state = 'hr' then
    for v_uid in select u.id from public.users u where u.role in ('hr', 'admin') and coalesce(u.is_active, true)
    loop
      perform public.athar_upsert_notification(
        v_uid, 'pending_' || NEW.id::text,
        'قرار الموارد البشرية مطلوب', v_body, 'orange', 'fa-bell', NEW.id, 'mine', false, null, null
      );
    end loop;
  end if;
  end if;

  -- تنبيهات مدير الفرع لفريقه
  if NEW.branch_id is not null and v_state in ('sup', 'aud', 'mgt', 'hr', 'Warning_Issued') then
    for v_uid in
      select u.id from public.users u
      where u.branch_id = NEW.branch_id
        and u.role = 'branch_manager'
        and coalesce(u.is_active, true)
        and (NEW.employee_id is null or u.id <> NEW.employee_id)
    loop
      v_title := case v_state
        when 'sup' then case when v_is_auto then 'تم تمرير مخالفة موظف فريقك للمشرف (تمرير تلقائي)' else 'رد موظف ضمن فريقك على المخالفة' end
        when 'aud' then case when v_is_auto then 'تم تمرير مخالفة موظف فريقك للمدقق (تمرير تلقائي)' else 'مخالفة موظف فريقك بانتظار التدقيق' end
        when 'mgt' then 'مخالفة موظف فريقك بانتظار القرار الإداري'
        when 'hr' then 'مخالفة موظف فريقك بانتظار الموارد البشرية'
        when 'Warning_Issued' then 'تنبيه إداري صادر على موظف ضمن فريقك'
        else 'تحديث مخالفة موظف ضمن فريقك'
      end;
      v_type := case v_state when 'sup' then 'blue' when 'aud' then 'purple' when 'mgt' then 'red' when 'hr' then 'orange' else 'amber' end;
      v_icon := case when v_is_auto and v_state in ('sup', 'aud') then 'fa-robot' else 'fa-reply' end;
      v_event := case
        when v_is_auto and v_state = 'sup' then 'auto_fwd_' || NEW.id::text || '_emp_to_sup'
        when v_is_auto and v_state = 'aud' then 'auto_fwd_' || NEW.id::text || '_sup_to_aud'
        else 'bm_team_status_' || NEW.id::text || '_' || v_state
      end;
      perform public.athar_upsert_notification(
        v_uid, v_event, v_title, v_body, v_type, v_icon, NEW.id, 'team', v_is_auto, null, null
      );
    end loop;
  end if;

  -- قرار نهائي (مغلقة)
  if v_state = 'closed' then
    v_st := coalesce(NEW.status_text, '');
    v_is_warn := v_st ~* 'تنبيه|اكتفاء بالتنبيه';
    v_is_penalty := v_st ~* 'معتمد' and not v_is_warn;
    v_is_cancelled := v_st ~* 'ملغ|مرفوض';

    if NEW.employee_id is not null then
      v_title := 'تم تحديث تذكرة بحقك';
      v_type := 'green';
      v_icon := 'fa-circle-check';
      if v_is_penalty then
        v_title := 'تم اعتماد مخالفة بحقك';
        v_type := 'red';
        v_icon := 'fa-triangle-exclamation';
      elsif v_is_warn then
        v_title := 'تم إصدار تنبيه إداري بحقك';
        v_type := 'amber';
        v_icon := 'fa-hand';
      elsif v_is_cancelled then
        v_title := 'تم إلغاء مخالفة بحقك';
      end if;
      perform public.athar_upsert_notification(
        NEW.employee_id, 'decided_' || NEW.id::text,
        v_title, coalesce(NEW.violation_type, '') || ' — ' || v_ticket,
        v_type, v_icon, NEW.id, 'mine', false, null, null
      );
    end if;

    if NEW.branch_id is not null and (v_is_penalty or v_is_warn or v_is_cancelled) then
      for v_uid in
        select u.id from public.users u
        where u.branch_id = NEW.branch_id
          and u.role = 'branch_manager'
          and coalesce(u.is_active, true)
          and (NEW.employee_id is null or u.id <> NEW.employee_id)
      loop
        v_title := 'تم تحديث مخالفة موظف ضمن فريقك';
        v_type := 'green';
        v_icon := 'fa-circle-check';
        if v_is_penalty then
          v_title := 'تم اعتماد مخالفة على موظف ضمن فريقك';
          v_type := 'red';
          v_icon := 'fa-triangle-exclamation';
        elsif v_is_warn then
          v_title := 'تم إصدار تنبيه إداري على موظف ضمن فريقك';
          v_type := 'amber';
          v_icon := 'fa-hand';
        elsif v_is_cancelled then
          v_title := 'تم إلغاء مخالفة موظف ضمن فريقك';
        end if;
        perform public.athar_upsert_notification(
          v_uid, 'bm_team_decided_' || NEW.id::text,
          v_title, v_body, v_type, v_icon, NEW.id, 'team', false, null, null
        );
      end loop;
    end if;

    -- إخفاء pending عند الإغلاق
    update public.notifications
    set dismissed_at = now()
    where ticket_id = NEW.id
      and event_key like 'pending_%'
      and dismissed_at is null;
  end if;

  -- تنبيه الراصد
  if NEW.observer_id is not null and (
    NEW.state is distinct from OLD.state
    or current_setting('athar.notif_backfill', true) = '1'
  ) then
    perform public.athar_upsert_notification(
      NEW.observer_id,
      'observer_state_' || NEW.id::text || '_' || v_state || '_' || to_char(coalesce(NEW.updated_at, now()), 'YYYYMMDDHH24MISS'),
      coalesce(NEW.status_text, v_state, 'تحديث على تذكرتك'),
      v_ticket || ' — ' || coalesce(NEW.violation_type, ''),
      'blue', 'fa-bell', NEW.id, 'mine', false, null, null
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists athar_violation_notify_insert on public.violations;
create trigger athar_violation_notify_insert
  after insert on public.violations
  for each row
  execute function public.athar_notify_violation_insert();

drop trigger if exists athar_violation_notify_state on public.violations;
create trigger athar_violation_notify_state
  after update of state, status_text on public.violations
  for each row
  execute function public.athar_notify_violation_state_change();

-- ─── 6) تنبيهات النشرات (من broadcast_inbox) ───
create or replace function public.athar_notify_broadcast_inbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_icon text;
  v_kind text;
begin
  v_kind := coalesce(NEW.kind, 'circular');
  v_type := case v_kind
    when 'motivational' then 'green'
    when 'alert' then 'amber'
    else 'blue'
  end;
  v_icon := case v_kind
    when 'motivational' then 'fa-trophy'
    when 'alert' then 'fa-triangle-exclamation'
    else 'fa-bullhorn'
  end;

  perform public.athar_upsert_notification(
    NEW.user_id,
    'broadcast_' || NEW.broadcast_id::text,
    coalesce(NEW.title, 'نشرة'),
    coalesce(NEW.body, ''),
    v_type, v_icon, null, 'mine', false,
    NEW.broadcast_id, v_kind
  );
  return NEW;
end;
$$;

drop trigger if exists athar_broadcast_inbox_notify on public.broadcast_inbox;
create trigger athar_broadcast_inbox_notify
  after insert on public.broadcast_inbox
  for each row
  execute function public.athar_notify_broadcast_inbox();

-- ─── 7) RLS ───
alter table public.notifications enable row level security;

drop policy if exists notifs_insert_system on public.notifications;
drop policy if exists notifs_read_own on public.notifications;
drop policy if exists notifs_update_own on public.notifications;
drop policy if exists notifs_service_all on public.notifications;

create policy notifs_read_own on public.notifications
  for select to authenticated
  using (
    public.current_user_is_active()
    and (
      public.current_user_role() = 'admin'
      or user_id = public.current_user_id()
    )
  );

create policy notifs_update_own on public.notifications
  for update to authenticated
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

create policy notifs_service_all on public.notifications
  for all to service_role
  using (true)
  with check (true);

grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ─── 8) backfill اختياري — يُعيد تشغيل منطق التنبيهات عبر تحديث وهمي للحالة ───
-- select public.athar_backfill_notifications_recent(120);

create or replace function public.athar_backfill_notifications_recent(p_limit int default 120)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  perform set_config('athar.notif_backfill', '1', true);
  for v_id in
    select id from public.violations
    where coalesce(state::text, '') not in ('uploading', 'draft')
    order by coalesce(updated_at, created_at) desc
    limit greatest(1, least(coalesce(p_limit, 120), 500))
  loop
    update public.violations
    set state = state
    where id = v_id;
    v_n := v_n + 1;
  end loop;
  perform set_config('athar.notif_backfill', '0', true);
  return v_n;
end;
$$;

revoke all on function public.athar_backfill_notifications_recent(int) from public;
grant execute on function public.athar_backfill_notifications_recent(int) to service_role;
