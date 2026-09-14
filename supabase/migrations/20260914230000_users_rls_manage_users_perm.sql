-- Allow accounts with platform permission manage_users to manage the users table.
-- UI already gates on canManageUsers()/manage_users; Auth ops go through admin-users Edge Function.
-- Previously RLS accepted only role = admin, so delegated managers got 403 / silent RLS failures.

DROP POLICY IF EXISTS users_update ON public.users;
DROP POLICY IF EXISTS users_update_admin_or_self ON public.users;
CREATE POLICY users_update_admin_manage_or_self
  ON public.users
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    OR public.user_has_platform_perm('manage_users')
    OR auth_uid = auth.uid()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.user_has_platform_perm('manage_users')
    OR auth_uid = auth.uid()
  );

DROP POLICY IF EXISTS users_insert ON public.users;
DROP POLICY IF EXISTS users_insert_admin ON public.users;
CREATE POLICY users_insert_admin_or_manage
  ON public.users
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.user_has_platform_perm('manage_users')
  );

DROP POLICY IF EXISTS users_delete ON public.users;
DROP POLICY IF EXISTS users_delete_admin ON public.users;
CREATE POLICY users_delete_admin_or_manage
  ON public.users
  FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    OR public.user_has_platform_perm('manage_users')
  );
