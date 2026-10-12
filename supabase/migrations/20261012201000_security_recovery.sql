BEGIN;

-- عدادات جديدة: لا بريد ولا IP خام؛ المفتاح HMAC-SHA-256 يُنشأ داخل Edge Function.
CREATE TABLE IF NOT EXISTS public.password_recovery_rate_limits (
  scope text NOT NULL CHECK (scope IN ('email', 'ip')),
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key_hash),
  CHECK (expires_at > window_started_at)
);

ALTER TABLE public.password_recovery_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_recovery_rate_limits FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS password_recovery_rate_limits_expires_at_idx
  ON public.password_recovery_rate_limits (expires_at);

-- لا يفتح هذا RPC لأي عميل. النافذة ثابتة 15 دقيقة، وليست حظراً دائماً.
CREATE OR REPLACE FUNCTION public.consume_password_recovery_rate_limit(
  p_email_key_hash text,
  p_ip_key_hash text
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_email_count integer := 0;
  v_ip_count integer := 0;
  v_email_expires timestamptz;
  v_ip_expires timestamptz;
  v_lock_one text;
  v_lock_two text;
  v_retry_seconds integer;
  c_email_limit constant integer := 3;
  c_ip_limit constant integer := 10;
  c_window interval := interval '15 minutes';
BEGIN
  IF p_email_key_hash IS NULL
     OR p_ip_key_hash IS NULL
     OR p_email_key_hash !~ '^[0-9a-f]{64}$'
     OR p_ip_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid rate-limit key';
  END IF;

  -- قفل منطقي مرتب دائماً قبل قراءة/تعديل الصفين؛ التنظيف مسار مستقل محدود.
  v_lock_one := least('email:' || p_email_key_hash, 'ip:' || p_ip_key_hash);
  v_lock_two := greatest('email:' || p_email_key_hash, 'ip:' || p_ip_key_hash);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_one, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_two, 0));

  SELECT attempt_count, expires_at
    INTO v_ip_count, v_ip_expires
  FROM public.password_recovery_rate_limits
  WHERE scope = 'ip' AND key_hash = p_ip_key_hash
  FOR UPDATE;

  IF COALESCE(v_ip_expires > v_now, false) AND v_ip_count >= c_ip_limit THEN
    v_retry_seconds := greatest(1, ceil(extract(epoch FROM (v_ip_expires - v_now)))::integer);
    RETURN QUERY SELECT false, v_retry_seconds;
    RETURN;
  END IF;

  SELECT attempt_count, expires_at
    INTO v_email_count, v_email_expires
  FROM public.password_recovery_rate_limits
  WHERE scope = 'email' AND key_hash = p_email_key_hash
  FOR UPDATE;

  IF COALESCE(v_email_expires > v_now, false) AND v_email_count >= c_email_limit THEN
    v_retry_seconds := greatest(1, ceil(extract(epoch FROM (v_email_expires - v_now)))::integer);
    RETURN QUERY SELECT false, v_retry_seconds;
    RETURN;
  END IF;

  INSERT INTO public.password_recovery_rate_limits (
    scope, key_hash, attempt_count, window_started_at, expires_at
  ) VALUES (
    'ip', p_ip_key_hash, 1, v_now, v_now + c_window
  )
  ON CONFLICT (scope, key_hash) DO UPDATE
    SET attempt_count = CASE
          WHEN public.password_recovery_rate_limits.expires_at <= v_now THEN 1
          ELSE public.password_recovery_rate_limits.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN public.password_recovery_rate_limits.expires_at <= v_now THEN v_now
          ELSE public.password_recovery_rate_limits.window_started_at
        END,
        expires_at = CASE
          WHEN public.password_recovery_rate_limits.expires_at <= v_now THEN v_now + c_window
          ELSE public.password_recovery_rate_limits.expires_at
        END;

  INSERT INTO public.password_recovery_rate_limits (
    scope, key_hash, attempt_count, window_started_at, expires_at
  ) VALUES (
    'email', p_email_key_hash, 1, v_now, v_now + c_window
  )
  ON CONFLICT (scope, key_hash) DO UPDATE
    SET attempt_count = CASE
          WHEN public.password_recovery_rate_limits.expires_at <= v_now THEN 1
          ELSE public.password_recovery_rate_limits.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN public.password_recovery_rate_limits.expires_at <= v_now THEN v_now
          ELSE public.password_recovery_rate_limits.window_started_at
        END,
        expires_at = CASE
          WHEN public.password_recovery_rate_limits.expires_at <= v_now THEN v_now + c_window
          ELSE public.password_recovery_rate_limits.expires_at
        END;

  RETURN QUERY SELECT true, 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_password_recovery_rate_limit(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_password_recovery_rate_limit(text, text)
  TO service_role;

-- تنظيف اختياري منفصل ومحدود لمسار cron/خادم موثوق فقط. يفيد index الانتهاء
-- هذا الاستعلام ولا يلمس مسار الاستهلاك أو يطيل أقفاله بمعالجة كل الـTTL.
CREATE OR REPLACE FUNCTION public.cleanup_password_recovery_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_deleted integer;
  c_batch_size constant integer := 100;
BEGIN
  WITH expired AS (
    SELECT ctid
    FROM public.password_recovery_rate_limits
    WHERE expires_at <= now()
    ORDER BY expires_at, ctid
    FOR UPDATE SKIP LOCKED
    LIMIT c_batch_size
  )
  DELETE FROM public.password_recovery_rate_limits AS target
  USING expired
  WHERE target.ctid = expired.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_password_recovery_rate_limits()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_password_recovery_rate_limits()
  TO service_role;

-- أوقف سطح RPC القديم الذي يقبل بريداً خاماً من العميل. لا تمنح clear لأي دور عميل.
REVOKE ALL ON FUNCTION public.record_password_reset_attempt(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_password_reset_rate_limit(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_password_reset_attempts(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.password_reset_attempts FROM PUBLIC, anon, authenticated;

COMMIT;
