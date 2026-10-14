-- Restore the read gate required by r2-storage proxyGet/signGet.
-- This is intentionally SECURITY INVOKER so existing RLS policies remain effective.
BEGIN;

CREATE OR REPLACE FUNCTION public.athar_attachment_json_has_key(p_items jsonb, p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END
    ) AS item(value)
    WHERE item.value ->> 'p' = p_key OR item.value ->> 'path' = p_key
  );
$fn$;

CREATE OR REPLACE FUNCTION public.athar_attachment_logs_have_key(p_logs jsonb, p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_logs) = 'array' THEN p_logs ELSE '[]'::jsonb END
    ) AS log_entry(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(log_entry.value -> 'attachments') = 'array'
           THEN log_entry.value -> 'attachments' ELSE '[]'::jsonb END
    ) AS item(value)
    WHERE item.value ->> 'p' = p_key OR item.value ->> 'path' = p_key
  );
$fn$;

CREATE OR REPLACE FUNCTION public.athar_attachment_key_is_valid(p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_key IS NOT NULL
    AND length(p_key) BETWEEN 1 AND 2048
    AND p_key ~ '^[A-Za-z0-9_.\/-]+$'
    AND position('..' IN p_key) = 0
    AND left(p_key, 1) <> '/' AND right(p_key, 1) <> '/'
    AND position('//' IN p_key) = 0 AND position(chr(92) IN p_key) = 0;
$fn$;

CREATE OR REPLACE FUNCTION public.athar_attachment_temp_key_is_owned(p_key text, p_uid uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.athar_attachment_key_is_valid(p_key)
    AND p_uid IS NOT NULL
    AND p_key ~ ('^temp_' || p_uid::text || '_[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$');
$fn$;

CREATE OR REPLACE FUNCTION public.athar_attachment_key_is_canonical(
  p_key text, p_record_type text, p_record_id uuid
)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.athar_attachment_key_is_valid(p_key)
    AND p_record_id IS NOT NULL
    AND ((p_record_type = 'violation' AND p_key LIKE ('violations/' || p_record_id::text || '/%'))
      OR (p_record_type = 'complaint' AND p_key LIKE ('complaints/' || p_record_id::text || '/%')));
$fn$;

CREATE TABLE IF NOT EXISTS public.athar_r2_legacy_attachment_keys (
  record_type text NOT NULL CHECK (record_type IN ('violation', 'complaint')),
  record_id uuid NOT NULL, object_key text NOT NULL,
  PRIMARY KEY (record_type, record_id, object_key)
);
ALTER TABLE public.athar_r2_legacy_attachment_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.athar_r2_legacy_attachment_keys FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.athar_attachment_can_read(p_key text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE ok boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.current_user_is_active()
     OR NOT public.athar_attachment_key_is_valid(p_key) THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.violations v
    WHERE (public.athar_attachment_json_has_key(v.attachments, p_key)
       OR public.athar_attachment_logs_have_key(v.logs, p_key))
      AND public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
  ) INTO ok;
  IF ok THEN RETURN true; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE (public.athar_attachment_json_has_key(c.attachments, p_key)
       OR public.athar_attachment_logs_have_key(c.logs, p_key))
      AND public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
  ) INTO ok;
  RETURN COALESCE(ok, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.athar_user_can_see_attachment(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $fn$ SELECT public.athar_attachment_can_read(p_key); $fn$;

REVOKE ALL ON FUNCTION public.athar_attachment_can_read(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_user_can_see_attachment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.athar_attachment_can_read(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.athar_user_can_see_attachment(text) TO authenticated, service_role;

COMMIT;
