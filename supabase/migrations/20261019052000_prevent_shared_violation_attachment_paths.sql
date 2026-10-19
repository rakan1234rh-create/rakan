-- Prevent one uploaded storage object from being attached to multiple violations.
-- This protects against concurrent/repeated submissions reusing a temp key.
BEGIN;

CREATE OR REPLACE FUNCTION public.athar_guard_unique_violation_attachment_paths()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.attachments IS NOT DISTINCT FROM OLD.attachments THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(NEW.attachments, '[]'::jsonb)) AS new_item
    JOIN public.violations AS other_v ON other_v.id <> NEW.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(other_v.attachments, '[]'::jsonb)) AS old_item
    WHERE NULLIF(new_item->>'p', '') IS NOT NULL
      AND new_item->>'p' = old_item->>'p'
  ) THEN
    RAISE EXCEPTION 'لا يمكن ربط نفس ملف المرفق بأكثر من مخالفة. أعد رفع الملف من جديد.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.athar_guard_unique_violation_attachment_paths() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.athar_guard_unique_violation_attachment_paths() FROM anon, authenticated;

DROP TRIGGER IF EXISTS athar_guard_unique_violation_attachment_paths_trg ON public.violations;
CREATE TRIGGER athar_guard_unique_violation_attachment_paths_trg
  BEFORE INSERT OR UPDATE OF attachments ON public.violations
  FOR EACH ROW
  EXECUTE FUNCTION public.athar_guard_unique_violation_attachment_paths();

COMMIT;
