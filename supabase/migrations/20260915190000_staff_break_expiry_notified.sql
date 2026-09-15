-- Track break-expiry Web Push so we notify once when planned duration elapses.
ALTER TABLE public.staff_breaks
  ADD COLUMN IF NOT EXISTS expiry_notified_at timestamptz;

COMMENT ON COLUMN public.staff_breaks.expiry_notified_at IS
  'When the employee was notified that break duration ended (Web Push / in-app).';

CREATE INDEX IF NOT EXISTS staff_breaks_active_expiry_notify_idx
  ON public.staff_breaks (status, started_at)
  WHERE status = 'active' AND expiry_notified_at IS NULL;
