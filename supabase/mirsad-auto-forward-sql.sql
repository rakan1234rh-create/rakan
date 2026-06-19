-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — التمرير التلقائي داخل PostgreSQL (بدون HTTP / بدون 401)
-- شغّل مرة واحدة في SQL Editor، ثم شغّل violation-auto-forward-cron.sql
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ─── جدول أسرار داخلي (لإرسال التنبيهات عبر violation-push) ───
-- يُقفل بـ RLS بدون سياسات، فلا يُقرأ عبر API. الدوال security definer تتجاوزه.
create table if not exists public.mirsad_secrets (
  key text primary key,
  value text not null
);
alter table public.mirsad_secrets enable row level security;

-- خزّن المفتاحين مرة واحدة (Settings → API):
--   select public.mirsad_set_secret('service_role_key', 'eyJ...مفتاح_service_role_الكامل');
--   select public.mirsad_set_secret('supabase_url', 'https://rizoafuxmqsddjfhbsmf.supabase.co');
create or replace function public.mirsad_set_secret(p_key text, p_value text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.mirsad_secrets (key, value)
  values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
$$;

-- ─── هل مرحلة مُلغاة من إعدادات المنصة؟ ───
create or replace function public.mirsad_workflow_stage_skipped(p_stage text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select nullif(ps.value->'workflow_skips'->>case p_stage
        when 'sup' then 'skip_stage_supervisor'
        when 'aud' then 'skip_stage_auditor'
        when 'mgt' then 'skip_stage_manager'
        when 'hr' then 'skip_stage_hr'
        else ''
      end, '')::boolean
      from public.platform_settings ps
      where ps.key = 'permissions_bundle_v1'
      limit 1
    ),
    false
  );
$$;

-- ─── الحالة التالية بعد تجاوز المراحل المُلغاة ───
create or replace function public.mirsad_next_workflow_state(p_current text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  stages text[] := array['emp', 'sup', 'aud', 'mgt', 'hr'];
  i int;
  j int;
  idx int := 0;
begin
  for i in 1..coalesce(array_length(stages, 1), 0) loop
    if stages[i] = p_current then
      idx := i;
      exit;
    end if;
  end loop;

  if idx > 0 then
    for j in idx + 1..array_length(stages, 1) loop
      if not public.mirsad_workflow_stage_skipped(stages[j]) then
        return stages[j];
      end if;
    end loop;
  end if;

  return 'closed';
end;
$$;

-- ─── وقت دخول مرحلة المشرف (تقريب منطق الواجهة) ───
create or replace function public.mirsad_sup_stage_start_time(p_logs jsonb, p_auto_fwd_emp boolean, p_updated_at timestamptz, p_created_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select coalesce(
    (
      select (e->>'date')::timestamptz
      from jsonb_array_elements(coalesce(p_logs, '[]'::jsonb)) with ordinality as t(e, ord)
      where (e->>'action') ~* 'رد الموظف'
         or ((e->>'action') ~* 'تمرير تلقائي' and (e->>'action') ~* 'المشرف|بانتظار رد المشرف')
         or (e->>'action') ~* 'تمرير.*للمشرف'
      order by ord desc
      limit 1
    ),
    case when coalesce(p_auto_fwd_emp, false) then p_updated_at else null end,
    p_created_at
  );
$$;

create or replace function public.mirsad_now_ksa_text()
returns text
language sql
stable
as $$
  select to_char(timezone('Asia/Riyadh', now()), 'YYYY-MM-DD HH24:MI');
$$;

-- ─── التمرير التلقائي الرئيسي ───
create or replace function public.mirsad_auto_forward_overdue_violations()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_new_state text;
  v_action text;
  v_note text;
  v_log jsonb;
  v_logs jsonb;
  v_started timestamptz;
  v_forwarded int := 0;
  v_scanned int := 0;
  v_pushed int := 0;
  v_label text;
  v_service_key text;
  v_base_url text;
begin
  select value into v_service_key from public.mirsad_secrets where key = 'service_role_key';
  select value into v_base_url from public.mirsad_secrets where key = 'supabase_url';

  -- emp → التالي (عادة sup) بعد 24 ساعة
  for r in
    select v.*
    from public.violations v
    where v.state = 'emp'
      and coalesce(v.auto_forwarded_emp, false) = false
      and v.created_at <= now() - interval '24 hours'
    order by v.created_at
    limit 200
  loop
    v_scanned := v_scanned + 1;

    if exists (
      select 1 from jsonb_array_elements(coalesce(r.logs, '[]'::jsonb)) e
      where (e->>'action') ~* 'تمرير تلقائي.*(المشرف|بانتظار رد المشرف)'
    ) then
      continue;
    end if;

    v_new_state := public.mirsad_next_workflow_state('emp');
    select case v_new_state
      when 'sup' then 'بانتظار رد المشرف'
      when 'aud' then 'بانتظار التدقيق'
      when 'mgt' then 'بانتظار القرار الإداري'
      when 'hr' then 'بانتظار الموارد البشرية'
      when 'closed' then 'مغلقة'
      else v_new_state
    end into v_label;

    v_action := '⚠️ تمرير تلقائي — ' || v_label;
    v_note := 'تم تمرير التذكرة تلقائياً بعد انتهاء مهلة 24 ساعة دون رد من الموظف';
    v_log := jsonb_build_object(
      'date', public.mirsad_now_ksa_text(),
      'user', 'النظام',
      'role', 'النظام',
      'action', v_action,
      'note', v_note
    );
    v_logs := coalesce(r.logs, '[]'::jsonb) || v_log;

    update public.violations
    set state = v_new_state,
        logs = v_logs,
        auto_forwarded_emp = true,
        updated_at = now()
    where id = r.id
      and state = 'emp'
      and coalesce(auto_forwarded_emp, false) = false;

    if found then
      v_forwarded := v_forwarded + 1;

      if v_service_key is not null and v_base_url is not null then
        perform net.http_post(
          url := v_base_url || '/functions/v1/violation-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_key
          ),
          body := jsonb_build_object(
            'notifyState', true,
            'isAutoForward', true,
            'previousState', 'emp',
            'dedupeKey', 'sqlcron:' || r.id || ':emp:' || v_new_state,
            'record', jsonb_build_object(
              'id', r.id,
              'ticket_number', r.ticket_number,
              'violation_type', r.violation_type,
              'employee_id', r.employee_id,
              'branch_id', r.branch_id,
              'state', v_new_state,
              'auto_forwarded_emp', true,
              'auto_forwarded_sup', r.auto_forwarded_sup
            )
          )
        );
        v_pushed := v_pushed + 1;
      end if;
    end if;
  end loop;

  -- sup → التالي (عادة aud) بعد 48 ساعة
  if not public.mirsad_workflow_stage_skipped('sup') then
    for r in
      select v.*
      from public.violations v
      where v.state = 'sup'
        and coalesce(v.auto_forwarded_sup, false) = false
      order by v.created_at
      limit 200
    loop
      v_scanned := v_scanned + 1;
      v_started := public.mirsad_sup_stage_start_time(r.logs, r.auto_forwarded_emp, r.updated_at, r.created_at);

      if v_started is null or v_started > now() - interval '48 hours' then
        continue;
      end if;

      if exists (
        select 1 from jsonb_array_elements(coalesce(r.logs, '[]'::jsonb)) e
        where (e->>'action') ~* 'تمرير تلقائي.*(المدقق|بانتظار رد المدقق)'
      ) then
        continue;
      end if;

      v_new_state := public.mirsad_next_workflow_state('sup');
      select case v_new_state
        when 'aud' then 'بانتظار التدقيق'
        when 'mgt' then 'بانتظار القرار الإداري'
        when 'hr' then 'بانتظار الموارد البشرية'
        when 'closed' then 'مغلقة'
        else v_new_state
      end into v_label;

      v_action := '⚠️ تمرير تلقائي — ' || v_label;
      v_note := 'تم تمرير التذكرة تلقائياً بعد انتهاء مهلة 48 ساعة دون رد من المشرف';
      v_log := jsonb_build_object(
        'date', public.mirsad_now_ksa_text(),
        'user', 'النظام',
        'role', 'النظام',
        'action', v_action,
        'note', v_note
      );
      v_logs := coalesce(r.logs, '[]'::jsonb) || v_log;

      update public.violations
      set state = v_new_state,
          logs = v_logs,
          auto_forwarded_sup = true,
          updated_at = now()
      where id = r.id
        and state = 'sup'
        and coalesce(auto_forwarded_sup, false) = false;

      if found then
        v_forwarded := v_forwarded + 1;

        if v_service_key is not null and v_base_url is not null then
          perform net.http_post(
            url := v_base_url || '/functions/v1/violation-push',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || v_service_key
            ),
            body := jsonb_build_object(
              'notifyState', true,
              'isAutoForward', true,
              'previousState', 'sup',
              'dedupeKey', 'sqlcron:' || r.id || ':sup:' || v_new_state,
              'record', jsonb_build_object(
                'id', r.id,
                'ticket_number', r.ticket_number,
                'violation_type', r.violation_type,
                'employee_id', r.employee_id,
                'branch_id', r.branch_id,
                'state', v_new_state,
                'auto_forwarded_emp', r.auto_forwarded_emp,
                'auto_forwarded_sup', true
              )
            )
          );
          v_pushed := v_pushed + 1;
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'engine', 'postgres',
    'scanned', v_scanned,
    'forwarded', v_forwarded,
    'pushed', v_pushed,
    'push_configured', (v_service_key is not null and v_base_url is not null),
    'ran_at', now()
  );
end;
$$;

grant execute on function public.mirsad_auto_forward_overdue_violations() to postgres;

-- ═══════════════════════════════════════════════════════════════════════════
-- مهم لإرسال التنبيهات والمنصة مغلقة — خزّن المفتاحين مرة واحدة:
--   (Settings → API → service_role secret)
--
-- select public.mirsad_set_secret('service_role_key', 'eyJ...المفتاح_الكامل');
-- select public.mirsad_set_secret('supabase_url', 'https://rizoafuxmqsddjfhbsmf.supabase.co');
--
-- بدون هذين المفتاحين: التمرير يعمل لكن التنبيهات لا تُرسل تلقائياً.
-- ═══════════════════════════════════════════════════════════════════════════

-- اختبار فوري:
-- select public.mirsad_auto_forward_overdue_violations();
