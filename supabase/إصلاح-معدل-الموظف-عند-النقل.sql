-- ═══════════════════════════════════════════════════════════════════════════
-- إصلاح: معدل الالتزام لا يتبع الموظف بعد نقله لفرع آخر
-- السبب: سياسة RLS لمدير الفرع كانت تقرأ المخالفات بـ branch_id فقط
--        فالمخالفات القديمة (branch_id = الفرع السابق) لا تُحمَّل
-- الحل: إضافة قراءة مخالفات موظفي الفرع الحاليين عبر employee_id
-- شغّل في Supabase → SQL Editor (بعد rls_session_helpers.sql)
-- ═══════════════════════════════════════════════════════════════════════════

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

-- تحقق (كمدير فرع بعد تسجيل الدخول):
-- select count(*) from public.violations;
