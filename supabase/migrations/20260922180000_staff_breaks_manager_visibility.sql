-- Ensure org manager (المدير) and auditor (المدقق) can read all staff break
-- rows so active / stopped / ended sessions appear on their breaks page.
-- Also let branch managers see breaks for users in their branch even when
-- staff_breaks.branch_id was left null on older/restroom rows.

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
        AND (
          (
            branch_id IS NOT NULL
            AND branch_id = public.current_user_branch_id()
          )
          OR EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.id = staff_breaks.user_id
              AND u.branch_id IS NOT NULL
              AND u.branch_id = public.current_user_branch_id()
          )
        )
      )
      OR (
        public.current_user_role() = 'supervisor'
        AND (
          (
            branch_id IS NOT NULL
            AND branch_id = ANY (public.current_user_supervised_branches())
          )
          OR EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.id = staff_breaks.user_id
              AND u.branch_id IS NOT NULL
              AND u.branch_id = ANY (public.current_user_supervised_branches())
          )
        )
      )
      OR (
        public.current_user_role() = 'employee'
        AND (
          (
            branch_id IS NOT NULL
            AND branch_id = public.current_user_branch_id()
          )
          OR EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.id = staff_breaks.user_id
              AND u.branch_id IS NOT NULL
              AND u.branch_id = public.current_user_branch_id()
          )
        )
      )
    )
  );

COMMENT ON POLICY staff_breaks_select ON public.staff_breaks IS
  'Admin/manager/auditor see all; branch staff see own branch; supervisors see supervised branches.';
