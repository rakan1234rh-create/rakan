-- The same evidence may be intentionally attached to multiple violations.
-- Do not enforce global uniqueness on storage paths; isolate upload sessions
-- and submissions instead of blocking legitimate evidence reuse.
BEGIN;

DROP TRIGGER IF EXISTS athar_guard_unique_violation_attachment_paths_trg ON public.violations;
DROP FUNCTION IF EXISTS public.athar_guard_unique_violation_attachment_paths();

COMMIT;
