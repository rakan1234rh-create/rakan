-- Allow employees to file complaints/suggestions anonymously in the UI.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.complaints.is_anonymous IS
  'When true, UI shows the submitter as مجهول instead of their real name.';
