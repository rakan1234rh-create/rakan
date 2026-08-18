-- Allow the auditor (المدقق) to read all staff break rows, same as admin/manager.

DROP POLICY IF EXISTS staff_breaks_select ON public.staff_breaks;
CREATE POLICY staff_breaks_select ON public.staff_breaks
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_active()
    AND (
      public.current_user_role() IN ('admin', 'manager', 'auditor')
      OR user_id = public.current_user_id()
      OR public.current_user_role() = 'observer'
      OR (
        public.current_user_role() = 'branch_manager'
        AND branch_id IS NOT NULL
        AND branch_id = public.current_user_branch_id()
      )
      OR (
        public.current_user_role() = 'supervisor'
        AND branch_id IS NOT NULL
        AND branch_id = ANY (public.current_user_supervised_branches())
      )
      OR (
        public.current_user_role() = 'employee'
        AND branch_id IS NOT NULL
        AND branch_id = public.current_user_branch_id()
      )
    )
  );
