BEGIN;

-- لا يخزن الجدول nonce أو IP أو body أو توقيعاً خاماً؛ يحتفظ فقط بـ SHA-256
-- مفصول المجال للـ nonce العشوائي وتاريخ الانتهاء القصير اللازم لمنع إعادة الإرسال.
CREATE TABLE IF NOT EXISTS public.auth_ingress_replays (
  nonce_hash text PRIMARY KEY CHECK (nonce_hash ~ '^[a-f0-9]{64}$'),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > consumed_at)
);

ALTER TABLE public.auth_ingress_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_ingress_replays FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS auth_ingress_replays_expires_at_idx
  ON public.auth_ingress_replays (expires_at);

-- يتطلب هذا RPC service_role فقط. INSERT ... ON CONFLICT هو قرار الاستهلاك
-- الذري؛ لا يوجد فحص ثم إدراج قابل للتسابق بين نسختين من Edge Function.
CREATE OR REPLACE FUNCTION public.consume_auth_ingress_replay(
  p_nonce_hash text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_nonce_hash IS NULL
     OR p_nonce_hash !~ '^[a-f0-9]{64}$'
     OR p_expires_at IS NULL
     OR p_expires_at <= v_now
     -- Edge accepts a timestamp for only 60 seconds and writes a 120-second
     -- replay window. Keep a defense-in-depth maximum if a compromised caller
     -- reaches service_role, so a replay row cannot become durable.
     OR p_expires_at > v_now + interval '5 minutes' THEN
    RETURN false;
  END IF;

  INSERT INTO public.auth_ingress_replays (nonce_hash, consumed_at, expires_at)
  VALUES (p_nonce_hash, v_now, p_expires_at)
  ON CONFLICT (nonce_hash) DO NOTHING;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_auth_ingress_replay(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_ingress_replay(text, timestamptz)
  TO service_role;

-- Cleanup remains outside the critical consume path and deletes a small, locked
-- batch so it neither scans all TTL rows nor waits behind active inserts.
CREATE OR REPLACE FUNCTION public.cleanup_auth_ingress_replays()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted integer;
  c_batch_size constant integer := 500;
BEGIN
  WITH expired AS (
    SELECT ctid
    FROM public.auth_ingress_replays
    WHERE expires_at <= now()
    ORDER BY expires_at, ctid
    FOR UPDATE SKIP LOCKED
    LIMIT c_batch_size
  )
  DELETE FROM public.auth_ingress_replays AS target
  USING expired
  WHERE target.ctid = expired.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_auth_ingress_replays()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_auth_ingress_replays()
  TO service_role;

COMMIT;
