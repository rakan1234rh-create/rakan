-- Follow-up hardening for typed staff breaks.

-- This helper mutates open sessions and must only be called internally by the
-- admin-checked upsert_staff_break_schedule SECURITY DEFINER function.
REVOKE ALL ON FUNCTION public.apply_staff_break_duration_to_open(
  text, uuid, smallint, integer, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Mutating public RPCs still validate the signed-in user internally, but
-- removing PUBLIC execution keeps anonymous callers out before function entry.
REVOKE ALL ON FUNCTION public.upsert_staff_break_schedule(
  text, uuid, smallint, integer, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_staff_break_schedule(
  text, uuid, smallint, integer, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.start_staff_break(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_staff_break(text) TO authenticated;

-- Enforce the existing business rule at the database level to close the race
-- between two employees starting either break type in the same branch.
CREATE UNIQUE INDEX IF NOT EXISTS staff_breaks_one_active_per_branch
  ON public.staff_breaks (branch_id)
  WHERE status = 'active' AND branch_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
