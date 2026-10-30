-- Durable idempotency for violation emails (Hostinger SMTP).
-- Prevents duplicate sends when both the DB webhook and the browser
-- call violation-push for the same insert (or when a path is retried).
-- Future violations only — no historical backfill/resend.

CREATE TABLE IF NOT EXISTS public.violation_email_deliveries (
  violation_id uuid NOT NULL,
  event_key text NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status = ANY (ARRAY['claimed'::text, 'sent'::text, 'failed'::text])),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  CONSTRAINT violation_email_deliveries_pkey
    PRIMARY KEY (violation_id, event_key, recipient_email)
);

CREATE INDEX IF NOT EXISTS violation_email_deliveries_claimed_at_idx
  ON public.violation_email_deliveries (claimed_at DESC);

COMMENT ON TABLE public.violation_email_deliveries IS
  'Claim ledger so each violation email event is sent at most once per recipient';

ALTER TABLE public.violation_email_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.violation_email_deliveries FROM PUBLIC;
REVOKE ALL ON TABLE public.violation_email_deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.violation_email_deliveries TO service_role;

-- Atomic claim: 'acquired' (caller must send) or 'skip' (already sent / in flight).
CREATE OR REPLACE FUNCTION public.athar_claim_violation_email(
  p_violation_id uuid,
  p_event_key text,
  p_email text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key text := trim(coalesce(p_event_key, ''));
  v_status text;
  v_claimed_at timestamptz;
  v_updated int;
BEGIN
  IF p_violation_id IS NULL OR v_key = '' OR v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN 'skip';
  END IF;

  INSERT INTO public.violation_email_deliveries (
    violation_id, event_key, recipient_email, status, claimed_at
  )
  VALUES (p_violation_id, v_key, v_email, 'claimed', now())
  ON CONFLICT (violation_id, event_key, recipient_email) DO NOTHING
  RETURNING status INTO v_status;

  IF v_status IS NOT NULL THEN
    RETURN 'acquired';
  END IF;

  SELECT status, claimed_at
    INTO v_status, v_claimed_at
  FROM public.violation_email_deliveries
  WHERE violation_id = p_violation_id
    AND event_key = v_key
    AND recipient_email = v_email;

  IF v_status = 'sent' THEN
    RETURN 'skip';
  END IF;

  IF v_status = 'claimed'
     AND v_claimed_at IS NOT NULL
     AND v_claimed_at > now() - interval '10 minutes' THEN
    RETURN 'skip';
  END IF;

  UPDATE public.violation_email_deliveries
  SET status = 'claimed',
      claimed_at = now(),
      last_error = NULL,
      sent_at = NULL
  WHERE violation_id = p_violation_id
    AND event_key = v_key
    AND recipient_email = v_email
    AND (
      status = 'failed'
      OR (status = 'claimed' AND claimed_at <= now() - interval '10 minutes')
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN
    RETURN 'acquired';
  END IF;

  RETURN 'skip';
END;
$function$;

CREATE OR REPLACE FUNCTION public.athar_complete_violation_email(
  p_violation_id uuid,
  p_event_key text,
  p_email text,
  p_ok boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_key text := trim(coalesce(p_event_key, ''));
BEGIN
  IF p_violation_id IS NULL OR v_key = '' OR v_email = '' THEN
    RETURN;
  END IF;

  IF coalesce(p_ok, false) THEN
    UPDATE public.violation_email_deliveries
    SET status = 'sent',
        sent_at = now(),
        last_error = NULL
    WHERE violation_id = p_violation_id
      AND event_key = v_key
      AND recipient_email = v_email;
  ELSE
    UPDATE public.violation_email_deliveries
    SET status = 'failed',
        last_error = left(coalesce(p_error, 'send failed'), 500)
    WHERE violation_id = p_violation_id
      AND event_key = v_key
      AND recipient_email = v_email
      AND status IS DISTINCT FROM 'sent';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.athar_claim_violation_email(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.athar_claim_violation_email(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_claim_violation_email(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.athar_complete_violation_email(uuid, text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.athar_complete_violation_email(uuid, text, text, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.athar_complete_violation_email(uuid, text, text, boolean, text) TO service_role;
