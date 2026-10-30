-- Fix violation-push DB webhook auth after legacy service_role JWT stopped matching
-- the Edge Function secret key (sb_secret / rotated keys).
-- Gateway still needs a valid project API key on Authorization/apikey; use the
-- public anon key for that, and authenticate the webhook with x-athar-push-secret.

CREATE TABLE IF NOT EXISTS public.athar_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- Public anon key (same value already shipped to the browser). Used only so
-- pg_net requests pass the Supabase API gateway when verify_jwt=false.
INSERT INTO public.athar_secrets AS s (key, value)
VALUES (
  'anon_key',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtZGtsZHhib2NicGlwdGRvZG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMjE1MDgsImV4cCI6MjEwNjU5NzUwOH0.99UW9KaWjxP0Ufpr8crIDzt24xFdBa3YSFmCe5lwBv8'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value
WHERE s.value IS DISTINCT FROM EXCLUDED.value;

-- Shared webhook secret for DB → violation-push (header x-athar-push-secret).
INSERT INTO public.athar_secrets (key, value)
VALUES (
  'violation_push_webhook_secret',
  encode(gen_random_bytes(32), 'hex')
)
ON CONFLICT (key) DO NOTHING;

-- Keep production URL correct for any SQL paths that notify via athar_secrets.
INSERT INTO public.athar_secrets AS s (key, value)
VALUES ('supabase_url', 'https://cmdkldxbocbpiptdodmp.supabase.co')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value
WHERE s.value IS DISTINCT FROM EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.athar_violation_push_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'extensions'
AS $function$
DECLARE
  payload jsonb;
  anon_key text;
  push_secret text;
  push_url constant text := 'https://cmdkldxbocbpiptdodmp.supabase.co/functions/v1/violation-push';
BEGIN
  BEGIN
    SELECT trim(s.value) INTO anon_key
    FROM public.athar_secrets s
    WHERE s.key = 'anon_key'
    LIMIT 1;

    SELECT trim(s.value) INTO push_secret
    FROM public.athar_secrets s
    WHERE s.key = 'violation_push_webhook_secret'
    LIMIT 1;

    IF anon_key IS NULL OR length(anon_key) < 20 THEN
      RAISE WARNING 'athar_violation_push_notify: athar_secrets.anon_key missing — skip push';
      RETURN NEW;
    END IF;

    IF push_secret IS NULL OR length(push_secret) < 20 THEN
      RAISE WARNING 'athar_violation_push_notify: athar_secrets.violation_push_webhook_secret missing — skip push';
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
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key,
        'x-athar-push-secret', push_secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'athar_violation_push_notify failed (insert continues): %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- Keep vault secret aligned for operators who still inspect vault
-- (value is the webhook secret, not a service_role JWT).
DO $$
DECLARE
  v_id uuid;
  v_secret text;
BEGIN
  SELECT trim(value) INTO v_secret
  FROM public.athar_secrets
  WHERE key = 'violation_push_webhook_secret'
  LIMIT 1;

  IF v_secret IS NULL OR length(v_secret) < 20 THEN
    RETURN;
  END IF;

  SELECT id INTO v_id
  FROM vault.secrets
  WHERE name = 'athar_violation_push_service_role'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(
      v_id,
      v_secret,
      'athar_violation_push_service_role',
      'Shared x-athar-push-secret for violation-push DB webhook (not a service_role JWT)'
    );
  ELSE
    PERFORM vault.create_secret(
      v_secret,
      'athar_violation_push_service_role',
      'Shared x-athar-push-secret for violation-push DB webhook (not a service_role JWT)'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'vault sync for violation push webhook secret skipped: %', SQLERRM;
END $$;
