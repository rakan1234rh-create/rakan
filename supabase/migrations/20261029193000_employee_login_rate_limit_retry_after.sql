-- Return remaining lockout seconds from employee-login rate limiter so the
-- client can show an Arabic wait message with an explicit minute number.
BEGIN;

DROP FUNCTION IF EXISTS public.consume_employee_login_rate_limit(text);

CREATE OR REPLACE FUNCTION public.consume_employee_login_rate_limit(p_key_hash text)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_blocked_until timestamptz;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'مفتاح حد المحاولات غير صالح'
      USING ERRCODE = '22023';
  END IF;

  -- Bound retained pseudonymous keys even if no cleanup job runs separately.
  DELETE FROM public.employee_login_rate_limits
  WHERE key_hash IN (
    SELECT key_hash
    FROM public.employee_login_rate_limits
    WHERE expires_at <= v_now
    ORDER BY expires_at
    LIMIT 100
  );

  INSERT INTO public.employee_login_rate_limits AS l (
    key_hash,
    window_started_at,
    attempt_count,
    blocked_until,
    expires_at,
    updated_at
  )
  VALUES (p_key_hash, v_now, 1, NULL, v_now + interval '1 hour', v_now)
  ON CONFLICT (key_hash) DO UPDATE
  SET
    window_started_at = CASE
      WHEN l.window_started_at <= v_now - interval '15 minutes' THEN v_now
      ELSE l.window_started_at
    END,
    attempt_count = CASE
      WHEN l.window_started_at <= v_now - interval '15 minutes' THEN 1
      WHEN l.blocked_until IS NOT NULL AND l.blocked_until > v_now THEN l.attempt_count
      ELSE l.attempt_count + 1
    END,
    blocked_until = CASE
      WHEN l.window_started_at <= v_now - interval '15 minutes' THEN NULL
      WHEN l.blocked_until IS NOT NULL AND l.blocked_until > v_now THEN l.blocked_until
      WHEN l.attempt_count >= 5 THEN v_now + interval '15 minutes'
      ELSE NULL
    END,
    expires_at = v_now + interval '1 hour',
    updated_at = v_now
  RETURNING l.blocked_until INTO v_blocked_until;

  IF v_blocked_until IS NOT NULL AND v_blocked_until > v_now THEN
    RETURN QUERY SELECT
      false,
      greatest(1, ceil(extract(epoch FROM (v_blocked_until - v_now)))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_employee_login_rate_limit(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_employee_login_rate_limit(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_employee_login_rate_limit(text) TO service_role;

COMMIT;
