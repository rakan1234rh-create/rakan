-- Unblock violation INSERT: pg_net + fail-safe push trigger (correct Athar Free URL).
-- Service role key is read from vault secret "athar_violation_push_service_role"
-- (set out-of-band; never hardcode in migrations).

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.athar_violation_push_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'extensions'
AS $function$
DECLARE
  payload jsonb;
  svc_key text;
  push_url constant text := 'https://cmdkldxbocbpiptdodmp.supabase.co/functions/v1/violation-push';
BEGIN
  BEGIN
    BEGIN
      SELECT ds.decrypted_secret INTO svc_key
      FROM vault.decrypted_secrets ds
      WHERE ds.name = 'athar_violation_push_service_role'
      LIMIT 1;
    EXCEPTION WHEN undefined_table OR invalid_schema_name OR OTHERS THEN
      svc_key := NULL;
    END;

    IF svc_key IS NULL OR length(trim(svc_key)) < 20 THEN
      RAISE WARNING 'athar_violation_push_notify: vault secret athar_violation_push_service_role missing — skip push';
      RETURN NEW;
    END IF;

    payload := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW)
    );

    PERFORM net.http_post(
      url := push_url,
      body := payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || svc_key,
        'apikey', svc_key
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'athar_violation_push_notify failed (insert continues): %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
