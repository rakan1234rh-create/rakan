-- 1) Email alert opt-out store
-- 2) Lock athar_auto_forward_tick (service_role only)
-- 3) Revoke anon on attachment ACL RPC
-- 4) Drop temporary mirsad_* compatibility wrappers

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  email text PRIMARY KEY,
  channels text[] NOT NULL DEFAULT ARRAY['alerts']::text[],
  source text NOT NULL DEFAULT 'link',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_unsubscribes IS
  'Opt-out for ATHAR alert/digest emails (not auth/OTP mail).';

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

-- No direct client access; Edge uses service_role
REVOKE ALL ON TABLE public.email_unsubscribes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.athar_normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(COALESCE(p_email, '')));
$$;

CREATE OR REPLACE FUNCTION public.athar_record_email_unsubscribe(
  p_email text,
  p_channel text DEFAULT 'alerts',
  p_source text DEFAULT 'link'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_email text := public.athar_normalize_email(p_email);
  v_channel text := lower(trim(COALESCE(NULLIF(p_channel, ''), 'alerts')));
BEGIN
  IF v_email IS NULL OR v_email = '' OR position('@' in v_email) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'بريد غير صالح');
  END IF;

  IF v_channel NOT IN ('alerts', 'digest', 'all') THEN
    v_channel := 'alerts';
  END IF;

  INSERT INTO public.email_unsubscribes AS u (email, channels, source)
  VALUES (
    v_email,
    CASE WHEN v_channel = 'all' THEN ARRAY['alerts', 'digest']::text[]
         ELSE ARRAY[v_channel]::text[] END,
    left(COALESCE(NULLIF(p_source, ''), 'link'), 80)
  )
  ON CONFLICT (email) DO UPDATE
  SET
    channels = (
      SELECT ARRAY(SELECT DISTINCT c FROM unnest(
        u.channels || EXCLUDED.channels
      ) AS c ORDER BY 1)
    ),
    source = EXCLUDED.source,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'email', v_email);
END;
$$;

CREATE OR REPLACE FUNCTION public.athar_is_email_unsubscribed(
  p_email text,
  p_channel text DEFAULT 'alerts'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_email text := public.athar_normalize_email(p_email);
  v_channel text := lower(trim(COALESCE(NULLIF(p_channel, ''), 'alerts')));
  v_channels text[];
BEGIN
  IF v_email = '' THEN
    RETURN false;
  END IF;

  SELECT channels INTO v_channels
  FROM public.email_unsubscribes
  WHERE email = v_email;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN v_channel = ANY (v_channels) OR 'alerts' = ANY (v_channels);
END;
$$;

REVOKE ALL ON FUNCTION public.athar_record_email_unsubscribe(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_record_email_unsubscribe(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.athar_is_email_unsubscribed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_is_email_unsubscribed(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.athar_normalize_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.athar_normalize_email(text) TO service_role;

-- Lock auto-forward tick (was PUBLIC/anon executable)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('athar_auto_forward_tick', 'mirsad_auto_forward_tick', 'auto_forward_violations')
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO service_role';
  END LOOP;
END $$;

-- Attachment ACL: authenticated + service_role only (no anon probe)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('athar_user_can_see_attachment', 'mirsad_user_can_see_attachment')
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.sig || ' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO authenticated, service_role';
  END LOOP;
END $$;

-- Drop temporary mirsad_* wrappers (clients use athar_*)
DROP FUNCTION IF EXISTS public.mirsad_fetch_all_violations(integer);
DROP FUNCTION IF EXISTS public.mirsad_user_can_see_attachment(text);
DROP FUNCTION IF EXISTS public.mirsad_set_secret(text, text);
DROP FUNCTION IF EXISTS public.mirsad_execute_forward_job(uuid);
DROP FUNCTION IF EXISTS public.mirsad_auto_forward_tick();

COMMIT;
