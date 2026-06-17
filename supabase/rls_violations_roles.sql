-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — سياسات قراءة المخالفات (violations) حسب الدور + view_all_tickets
-- شغّل بعد: rls_session_helpers.sql و platform_settings.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.violations enable row level security;

-- ─── دالة: هل للمستخدم الحالي صلاحية من إعدادات المنصة؟ ───────────────────
create or replace function public.user_has_platform_perm(p_perm text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_uid uuid;
  v_bundle jsonb;
  v_roles jsonb;
  v_users jsonb;
  v_user_key text;
begin
  v_role := coalesce(public.current_user_role(), '');
  v_uid := public.current_user_id();
  if v_role = 'admin' then
    return true;
  end if;
  if not public.current_user_is_active() then
    return false;
  end if;

  v_bundle := public.get_platform_setting('permissions_bundle_v1');
  if v_bundle is not null then
    v_roles := v_bundle->'roles';
    v_users := v_bundle->'users';
  else
    v_roles := public.get_platform_setting('role_permissions');
  end if;

  if v_users is not null and v_uid is not null then
    v_user_key := v_uid::text;
    if v_users ? v_user_key and (v_users->v_user_key) ? p_perm then
      return coalesce((v_users->v_user_key->>p_perm)::boolean, false);
    end if;
  end if;

  if v_roles is not null and v_role <> '' and v_roles ? v_role and (v_roles->v_role) ? p_perm then
    return coalesce((v_roles->v_role->>p_perm)::boolean, false);
  end if;

  if p_perm = 'view_all_tickets' then
    return v_role in ('manager', 'auditor', 'hr');
  end if;

  return false;
end;
$$;

grant execute on function public.user_has_platform_perm(text) to authenticated;

-- ─── عرض كل المخالفات عند تفعيل view_all_tickets ─────────────────────────
drop policy if exists mirsad_gp_perm_view_all_violations on public.violations;
create policy mirsad_gp_perm_view_all_violations on public.violations
  for select to authenticated
  using (public.user_has_platform_perm('view_all_tickets'));

-- ─── مدير المنظمة (بدون view_all): مرحلتا الإدارة والتدقيق ────────────────
drop policy if exists mirsad_gp_manager_wf_violations on public.violations;
create policy mirsad_gp_manager_wf_violations on public.violations
  for select to authenticated
  using (
    public.current_user_role() = 'manager'
    and public.current_user_is_active()
    and not public.user_has_platform_perm('view_all_tickets')
    and state in ('mgt', 'aud')
  );

-- ─── مدقق (بدون view_all): مرحلة التدقيق فقط ─────────────────────────────
drop policy if exists mirsad_gp_auditor_wf_violations on public.violations;
create policy mirsad_gp_auditor_wf_violations on public.violations
  for select to authenticated
  using (
    public.current_user_role() = 'auditor'
    and public.current_user_is_active()
    and not public.user_has_platform_perm('view_all_tickets')
    and state = 'aud'
  );

-- ─── مشرف: فروع إشرافه (عند عدم view_all) ─────────────────────────────────
drop policy if exists mirsad_gp_supervisor_scoped_violations on public.violations;
create policy mirsad_gp_supervisor_scoped_violations on public.violations
  for select to authenticated
  using (
    public.current_user_role() = 'supervisor'
    and public.current_user_is_active()
    and not public.user_has_platform_perm('view_all_tickets')
    and branch_id = any(public.current_user_supervised_branches())
  );

-- ─── مدير فرع: فرعه + مخالفات موظفيه الحاليين (حتى لو branch_id في السجل قديم) ─
drop policy if exists mirsad_gp_branch_manager_violations on public.violations;
create policy mirsad_gp_branch_manager_violations on public.violations
  for select to authenticated
  using (
    public.current_user_role() = 'branch_manager'
    and public.current_user_is_active()
    and not public.user_has_platform_perm('view_all_tickets')
    and (
      employee_id = public.current_user_id()
      or branch_id = (
        select u.branch_id from public.users u
        where u.auth_uid = auth.uid() and u.is_active = true
        limit 1
      )
      or employee_id in (
        select u2.id from public.users u2
        where u2.is_active = true
          and u2.role in ('employee', 'branch_manager')
          and u2.branch_id = (
            select u.branch_id from public.users u
            where u.auth_uid = auth.uid() and u.is_active = true
            limit 1
          )
      )
    )
  );

-- ─── موظف: تذاكره فقط ─────────────────────────────────────────────────────
drop policy if exists mirsad_gp_employee_violations on public.violations;
create policy mirsad_gp_employee_violations on public.violations
  for select to authenticated
  using (
    public.current_user_role() = 'employee'
    and public.current_user_is_active()
    and employee_id = public.current_user_id()
  );

-- ─── مراقب: التذاكر المسندة إليه ─────────────────────────────────────────
drop policy if exists mirsad_gp_observer_violations on public.violations;
create policy mirsad_gp_observer_violations on public.violations
  for select to authenticated
  using (
    public.current_user_role() = 'observer'
    and public.current_user_is_active()
    and observer_id = public.current_user_id()
  );

-- ─── RPC: جلب كل المخالفات عند view_all_tickets (يتجاوز RLS المقيّد) ─────
create or replace function public.mirsad_fetch_all_violations(p_limit int default 1000)
returns setof public.violations
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
begin
  if not public.current_user_is_active() then
    return;
  end if;
  if public.current_user_role() <> 'admin'
     and not public.user_has_platform_perm('view_all_tickets') then
    return;
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 1000), 2000));
  return query
    select v.*
    from public.violations v
    order by v.created_at desc
    limit v_limit;
end;
$$;

grant execute on function public.mirsad_fetch_all_violations(int) to authenticated;

-- تحقق:
-- select public.user_has_platform_perm('view_all_tickets');
-- select count(*) from public.mirsad_fetch_all_violations(2000);
