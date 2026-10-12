-- Security R2: every new attachment reference is bound to the record UUID that owns it.
-- No storage object is moved or deleted by this migration.
BEGIN;

-- Exact JSON match only: never authorize an object by its basename or a substring.
CREATE OR REPLACE FUNCTION public.athar_attachment_json_has_key(p_items jsonb, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END
    ) AS item(value)
    WHERE item.value ->> 'p' = p_key
       OR item.value ->> 'path' = p_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.athar_attachment_logs_have_key(p_logs jsonb, p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_logs) = 'array' THEN p_logs ELSE '[]'::jsonb END
    ) AS log_entry(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(log_entry.value -> 'attachments') = 'array'
          THEN log_entry.value -> 'attachments'
        ELSE '[]'::jsonb
      END
    ) AS item(value)
    WHERE item.value ->> 'p' = p_key
       OR item.value ->> 'path' = p_key
  );
$function$;

-- Mirrors the Edge helper. The database must not trust a client that bypasses
-- the handler and writes p_attachments directly through an otherwise allowed RPC.
CREATE OR REPLACE FUNCTION public.athar_attachment_key_is_valid(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_key IS NOT NULL
    AND length(p_key) BETWEEN 1 AND 2048
    AND p_key ~ '^[A-Za-z0-9_.\/-]+$'
    AND position('..' IN p_key) = 0
    AND left(p_key, 1) <> '/'
    AND right(p_key, 1) <> '/'
    AND position('//' IN p_key) = 0
    AND position(chr(92) IN p_key) = 0;
$function$;

CREATE OR REPLACE FUNCTION public.athar_attachment_temp_key_is_owned(p_key text, p_uid uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.athar_attachment_key_is_valid(p_key)
    AND p_uid IS NOT NULL
    AND p_key ~ ('^temp_' || p_uid::text || '_[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$');
$function$;

CREATE OR REPLACE FUNCTION public.athar_attachment_key_is_canonical(
  p_key text,
  p_record_type text,
  p_record_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.athar_attachment_key_is_valid(p_key)
    AND p_record_id IS NOT NULL
    AND (
      (p_record_type = 'violation' AND p_key LIKE ('violations/' || p_record_id::text || '/%'))
      OR
      (p_record_type = 'complaint' AND p_key LIKE ('complaints/' || p_record_id::text || '/%'))
    );
$function$;

-- A private compatibility ledger freezes only paths that already existed when
-- this migration is applied. New/changed references are never allowed to use
-- a legacy path. This keeps old objects readable without turning a mutable
-- JSONB reference into an object-capability for another record.
-- The read-gate role cannot log in or be assumed by browser roles. It owns no
-- application table and inherits authenticated solely so its SECURITY DEFINER
-- read function remains subject to the normal `TO authenticated` RLS policies.
-- It is therefore able to consult the private ledger without bypassing ticket
-- visibility or exposing a ledger-enumeration RPC.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'athar_r2_read_gate') THEN
    CREATE ROLE athar_r2_read_gate NOLOGIN INHERIT;
  END IF;
END
$role$;
GRANT authenticated TO athar_r2_read_gate;

CREATE TABLE IF NOT EXISTS public.athar_r2_legacy_attachment_keys (
  record_type text NOT NULL CHECK (record_type IN ('violation', 'complaint')),
  record_id uuid NOT NULL,
  object_key text NOT NULL,
  PRIMARY KEY (record_type, record_id, object_key)
);

ALTER TABLE public.athar_r2_legacy_attachment_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.athar_r2_legacy_attachment_keys FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO athar_r2_read_gate;
GRANT SELECT ON TABLE public.violations, public.complaints TO athar_r2_read_gate;
GRANT SELECT ON TABLE public.athar_r2_legacy_attachment_keys TO athar_r2_read_gate;
DROP POLICY IF EXISTS athar_r2_legacy_attachment_keys_read_gate
  ON public.athar_r2_legacy_attachment_keys;
CREATE POLICY athar_r2_legacy_attachment_keys_read_gate
  ON public.athar_r2_legacy_attachment_keys
  FOR SELECT TO athar_r2_read_gate
  USING (true);

-- This marker is deliberately independent of the ledger keys. Re-applying the
-- migration must not turn keys introduced after the original cut-over into
-- frozen legacy paths. The advisory lock also makes concurrent attempts choose
-- exactly one snapshot transaction.
CREATE TABLE IF NOT EXISTS public.athar_r2_legacy_attachment_freeze_marker (
  marker text PRIMARY KEY CHECK (marker = 'r2-legacy-attachments-v1'),
  frozen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.athar_r2_legacy_attachment_freeze_marker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.athar_r2_legacy_attachment_freeze_marker FROM PUBLIC, anon, authenticated;

DO $freeze$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('athar-r2-legacy-attachments-v1', 0));
  IF EXISTS (
    SELECT 1 FROM public.athar_r2_legacy_attachment_freeze_marker
    WHERE marker = 'r2-legacy-attachments-v1'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.athar_r2_legacy_attachment_keys (record_type, record_id, object_key)
  SELECT 'violation', v.id, COALESCE(item.value ->> 'p', item.value ->> 'path')
  FROM public.violations v
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(v.attachments) = 'array' THEN v.attachments ELSE '[]'::jsonb END
  ) AS item(value)
  WHERE COALESCE(item.value ->> 'p', item.value ->> 'path') IS NOT NULL
    AND NOT public.athar_attachment_key_is_canonical(
      COALESCE(item.value ->> 'p', item.value ->> 'path'), 'violation', v.id
    )
    AND COALESCE(item.value ->> 'p', item.value ->> 'path') !~
      '^temp_[0-9A-Fa-f-]{36}_[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.athar_r2_legacy_attachment_keys (record_type, record_id, object_key)
  SELECT 'violation', v.id, COALESCE(item.value ->> 'p', item.value ->> 'path')
  FROM public.violations v
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(v.logs) = 'array' THEN v.logs ELSE '[]'::jsonb END
  ) AS log_entry(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(log_entry.value -> 'attachments') = 'array'
         THEN log_entry.value -> 'attachments' ELSE '[]'::jsonb END
  ) AS item(value)
  WHERE COALESCE(item.value ->> 'p', item.value ->> 'path') IS NOT NULL
    AND NOT public.athar_attachment_key_is_canonical(
      COALESCE(item.value ->> 'p', item.value ->> 'path'), 'violation', v.id
    )
    AND COALESCE(item.value ->> 'p', item.value ->> 'path') !~
      '^temp_[0-9A-Fa-f-]{36}_[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.athar_r2_legacy_attachment_keys (record_type, record_id, object_key)
  SELECT 'complaint', c.id, COALESCE(item.value ->> 'p', item.value ->> 'path')
  FROM public.complaints c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.attachments) = 'array' THEN c.attachments ELSE '[]'::jsonb END
  ) AS item(value)
  WHERE COALESCE(item.value ->> 'p', item.value ->> 'path') IS NOT NULL
    AND NOT public.athar_attachment_key_is_canonical(
      COALESCE(item.value ->> 'p', item.value ->> 'path'), 'complaint', c.id
    )
    AND COALESCE(item.value ->> 'p', item.value ->> 'path') !~
      '^temp_[0-9A-Fa-f-]{36}_[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.athar_r2_legacy_attachment_keys (record_type, record_id, object_key)
  SELECT 'complaint', c.id, COALESCE(item.value ->> 'p', item.value ->> 'path')
  FROM public.complaints c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.logs) = 'array' THEN c.logs ELSE '[]'::jsonb END
  ) AS log_entry(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(log_entry.value -> 'attachments') = 'array'
         THEN log_entry.value -> 'attachments' ELSE '[]'::jsonb END
  ) AS item(value)
  WHERE COALESCE(item.value ->> 'p', item.value ->> 'path') IS NOT NULL
    AND NOT public.athar_attachment_key_is_canonical(
      COALESCE(item.value ->> 'p', item.value ->> 'path'), 'complaint', c.id
    )
    AND COALESCE(item.value ->> 'p', item.value ->> 'path') !~
      '^temp_[0-9A-Fa-f-]{36}_[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.athar_r2_legacy_attachment_freeze_marker (marker)
  VALUES ('r2-legacy-attachments-v1');
END
$freeze$;

CREATE OR REPLACE FUNCTION public.athar_attachment_is_frozen_legacy_key(
  p_record_type text,
  p_record_id uuid,
  p_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.athar_r2_legacy_attachment_keys l
    WHERE l.record_type = p_record_type
      AND l.record_id = p_record_id
      AND l.object_key = p_key
  );
$function$;

-- Validate keys introduced by an INSERT/UPDATE. Existing legacy keys remain
-- valid only when unchanged; the ledger above is not a write allow-list.
CREATE OR REPLACE FUNCTION public.athar_attachment_new_references_are_valid(
  p_new_attachments jsonb,
  p_new_logs jsonb,
  p_old_attachments jsonb,
  p_old_logs jsonb,
  p_record_type text,
  p_record_id uuid,
  p_uid uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH new_keys AS (
    SELECT COALESCE(item.value ->> 'p', item.value ->> 'path') AS object_key
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_new_attachments) = 'array' THEN p_new_attachments ELSE '[]'::jsonb END) AS item(value)
    UNION
    SELECT COALESCE(item.value ->> 'p', item.value ->> 'path') AS object_key
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_new_logs) = 'array' THEN p_new_logs ELSE '[]'::jsonb END) AS log_entry(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(log_entry.value -> 'attachments') = 'array'
           THEN log_entry.value -> 'attachments' ELSE '[]'::jsonb END
    ) AS item(value)
  ), old_keys AS (
    SELECT COALESCE(item.value ->> 'p', item.value ->> 'path') AS object_key
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_old_attachments) = 'array' THEN p_old_attachments ELSE '[]'::jsonb END) AS item(value)
    UNION
    SELECT COALESCE(item.value ->> 'p', item.value ->> 'path') AS object_key
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_old_logs) = 'array' THEN p_old_logs ELSE '[]'::jsonb END) AS log_entry(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(log_entry.value -> 'attachments') = 'array'
           THEN log_entry.value -> 'attachments' ELSE '[]'::jsonb END
    ) AS item(value)
  )
  SELECT NOT EXISTS (
    SELECT 1
    FROM new_keys n
    WHERE n.object_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM old_keys o WHERE o.object_key = n.object_key)
      AND NOT public.athar_attachment_key_is_canonical(n.object_key, p_record_type, p_record_id)
      AND NOT public.athar_attachment_temp_key_is_owned(n.object_key, p_uid)
  );
$function$;

CREATE OR REPLACE FUNCTION public.athar_guard_violation_attachment_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.athar_attachment_new_references_are_valid(
    NEW.attachments, NEW.logs,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.attachments ELSE '[]'::jsonb END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.logs ELSE '[]'::jsonb END,
    'violation', NEW.id, auth.uid()
  ) THEN
    RAISE EXCEPTION 'مفتاح مرفق غير صالح للسجل';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.athar_guard_complaint_attachment_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.athar_attachment_new_references_are_valid(
    NEW.attachments, NEW.logs,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.attachments ELSE '[]'::jsonb END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.logs ELSE '[]'::jsonb END,
    'complaint', NEW.id, auth.uid()
  ) THEN
    RAISE EXCEPTION 'مفتاح مرفق غير صالح للسجل';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS athar_guard_violation_attachment_references_trg ON public.violations;
CREATE TRIGGER athar_guard_violation_attachment_references_trg
  BEFORE INSERT OR UPDATE OF attachments, logs ON public.violations
  FOR EACH ROW EXECUTE FUNCTION public.athar_guard_violation_attachment_references();

DROP TRIGGER IF EXISTS athar_guard_complaint_attachment_references_trg ON public.complaints;
CREATE TRIGGER athar_guard_complaint_attachment_references_trg
  BEFORE INSERT OR UPDATE OF attachments, logs ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.athar_guard_complaint_attachment_references();

-- The dedicated non-login owner is a member of authenticated (and not a table
-- owner), so PostgreSQL applies the normal authenticated SELECT RLS policies
-- here. It has only the SELECT needed for the private ledger; browser roles do
-- not. This fixes legacy reads without granting an enumerable ledger helper to
-- PostgREST callers.
CREATE OR REPLACE FUNCTION public.athar_attachment_can_read(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.current_user_is_active()
    AND public.athar_attachment_key_is_valid(p_key)
    AND (
      EXISTS (
        SELECT 1
        FROM public.violations v
        WHERE (public.athar_attachment_json_has_key(v.attachments, p_key)
               OR public.athar_attachment_logs_have_key(v.logs, p_key))
          AND (
            public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
            OR EXISTS (
              SELECT 1
              FROM public.athar_r2_legacy_attachment_keys l
              WHERE l.record_type = 'violation'
                AND l.record_id = v.id
                AND l.object_key = p_key
            )
            OR public.athar_attachment_temp_key_is_owned(p_key, auth.uid())
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.complaints c
        WHERE (public.athar_attachment_json_has_key(c.attachments, p_key)
               OR public.athar_attachment_logs_have_key(c.logs, p_key))
          AND (
            public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
            OR EXISTS (
              SELECT 1
              FROM public.athar_r2_legacy_attachment_keys l
              WHERE l.record_type = 'complaint'
                AND l.record_id = c.id
                AND l.object_key = p_key
            )
            OR public.athar_attachment_temp_key_is_owned(p_key, auth.uid())
          )
      )
    );
$function$;
ALTER FUNCTION public.athar_attachment_can_read(text)
  OWNER TO athar_r2_read_gate;

-- Compatibility RPC used by existing clients. It now has exact-key + RLS
-- semantics rather than the historic filename substring lookup.
CREATE OR REPLACE FUNCTION public.athar_user_can_see_attachment(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.athar_attachment_can_read(p_key);
$function$;

-- Separate mutate permission from read permission. It never treats a mutable
-- JSONB reference as sufficient proof: the key must belong to this record's
-- canonical UUID prefix or the frozen migration-time legacy ledger.
CREATE OR REPLACE FUNCTION public.athar_attachment_can_modify(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_state text;
  v_employee_id uuid;
  v_branch_id uuid;
  v_complaint_employee_id uuid;
  v_complaint_status text;
BEGIN
  IF auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()
     OR NOT public.athar_attachment_key_is_valid(p_key) THEN
    RETURN false;
  END IF;

  SELECT v.state::text, v.employee_id, v.branch_id
    INTO v_state, v_employee_id, v_branch_id
  FROM public.violations v
  WHERE (public.athar_attachment_json_has_key(v.attachments, p_key)
         OR public.athar_attachment_logs_have_key(v.logs, p_key))
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'violation', v.id)
      OR public.athar_attachment_is_frozen_legacy_key('violation', v.id, p_key)
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN v_role = 'admin'
      OR public.user_has_platform_perm('act_all_tickets')
      OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
      OR (v_state = 'sup' AND v_role = 'supervisor'
          AND v_branch_id = ANY (public.current_user_supervised_branches()))
      OR (v_state = 'aud' AND v_role = 'auditor')
      OR (v_state = 'mgt' AND v_role = 'manager')
      OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
  END IF;

  SELECT c.employee_id, c.status
    INTO v_complaint_employee_id, v_complaint_status
  FROM public.complaints c
  WHERE (public.athar_attachment_json_has_key(c.attachments, p_key)
         OR public.athar_attachment_logs_have_key(c.logs, p_key))
    AND (
      public.athar_attachment_key_is_canonical(p_key, 'complaint', c.id)
      OR public.athar_attachment_is_frozen_legacy_key('complaint', c.id, p_key)
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN v_complaint_status = 'pending'
      AND (v_role = 'admin' OR v_complaint_employee_id = v_uid);
  END IF;

  RETURN false;
END;
$function$;

-- Destination authorization is required before a temp object has a final key
-- in JSONB. Final destinations are intentionally UUID-scoped, not ticket
-- numbers or names, so one writable record cannot reference another's object.
CREATE OR REPLACE FUNCTION public.athar_attachment_destination_can_modify(
  p_record_type text,
  p_record_id uuid,
  p_from_key text,
  p_to_key text,
  p_operation text,
  p_expected_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_state text;
  v_employee_id uuid;
  v_branch_id uuid;
  v_observer_id uuid;
  v_source_role text;
  v_created_at timestamptz;
  v_complaint_employee_id uuid;
  v_complaint_status text;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR v_uid IS NULL OR NOT public.current_user_is_active()
     OR p_record_id IS NULL
     OR p_record_type NOT IN ('violation', 'complaint')
     OR p_operation NOT IN ('create', 'reply', 'repair')
     OR NOT public.athar_attachment_temp_key_is_owned(p_from_key, auth.uid())
     OR NOT public.athar_attachment_key_is_canonical(p_to_key, p_record_type, p_record_id)
     OR regexp_replace(p_from_key, '^.*/', '') <> regexp_replace(p_to_key, '^.*/', '') THEN
    RETURN false;
  END IF;

  IF p_record_type = 'violation' THEN
    SELECT v.state::text, v.employee_id, v.branch_id, v.observer_id,
           v.source_role::text, v.created_at
      INTO v_state, v_employee_id, v_branch_id, v_observer_id,
           v_source_role, v_created_at
    FROM public.violations v
    WHERE v.id = p_record_id;
    IF NOT FOUND OR (p_expected_state IS NOT NULL AND v_state <> p_expected_state) THEN
      RETURN false;
    END IF;

    IF p_operation = 'create' THEN
      -- Only the creator may finish the initial temp -> final transfer, and
      -- only during the short creation window.
      v_allowed := v_observer_id = v_uid
        AND v_source_role = v_role
        AND v_created_at >= now() - interval '15 minutes';
    ELSIF p_operation = 'reply' THEN
      v_allowed := v_role = 'admin'
        OR public.user_has_platform_perm('act_all_tickets')
        OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
        OR (v_state = 'sup' AND v_role = 'supervisor'
            AND v_branch_id = ANY (public.current_user_supervised_branches()))
        OR (v_state = 'aud' AND v_role = 'auditor')
        OR (v_state = 'mgt' AND v_role = 'manager')
        OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
    ELSE
      v_allowed := v_role = 'admin'
        OR public.user_has_platform_perm('act_all_tickets')
        OR (v_state = 'emp' AND v_role IN ('employee', 'branch_manager') AND v_employee_id = v_uid)
        OR (v_state = 'sup' AND v_role = 'supervisor'
            AND v_branch_id = ANY (public.current_user_supervised_branches()))
        OR (v_state = 'aud' AND v_role = 'auditor')
        OR (v_state = 'mgt' AND v_role = 'manager')
        OR (v_state = 'hr' AND (v_role = 'hr' OR public.user_has_platform_perm('act_as_hr')));
    END IF;
    RETURN v_allowed;
  END IF;

  SELECT c.employee_id, c.status
    INTO v_complaint_employee_id, v_complaint_status
  FROM public.complaints c
  WHERE c.id = p_record_id;
  IF NOT FOUND OR v_complaint_status <> 'pending' THEN
    RETURN false;
  END IF;

  RETURN v_role = 'admin' OR v_complaint_employee_id = v_uid;
END;
$function$;

-- The client retains temp -> record -> copy. This narrow definer finalizes a
-- pre-existing reference only after the copy exists. It is deliberately not a
-- generic JSONB writer and it cannot finalize reply attachments (those are
-- committed by the existing guarded reply RPCs).
DROP FUNCTION IF EXISTS public.athar_finalize_attachment_path(text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.athar_finalize_attachment_path(
  p_record_type text,
  p_record_id uuid,
  p_from_key text,
  p_to_key text,
  p_operation text DEFAULT 'create',
  p_expected_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_updated integer := 0;
BEGIN
  IF p_operation NOT IN ('create', 'repair')
     OR NOT public.athar_attachment_destination_can_modify(
       p_record_type, p_record_id, p_from_key, p_to_key, p_operation, p_expected_state
     ) THEN
    RETURN false;
  END IF;

  IF p_record_type = 'violation' THEN
    UPDATE public.violations v
    SET attachments = (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN item.value ->> 'p' = p_from_key THEN jsonb_set(item.value, '{p}', to_jsonb(p_to_key), true)
          WHEN item.value ->> 'path' = p_from_key THEN jsonb_set(item.value, '{path}', to_jsonb(p_to_key), true)
          ELSE item.value
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.attachments) = 'array' THEN v.attachments ELSE '[]'::jsonb END) AS item(value)
    ), updated_at = now()
    WHERE v.id = p_record_id
      AND public.athar_attachment_json_has_key(v.attachments, p_from_key);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSIF p_record_type = 'complaint' THEN
    UPDATE public.complaints c
    SET attachments = (
      SELECT COALESCE(jsonb_agg(
        CASE
          WHEN item.value ->> 'p' = p_from_key THEN jsonb_set(item.value, '{p}', to_jsonb(p_to_key), true)
          WHEN item.value ->> 'path' = p_from_key THEN jsonb_set(item.value, '{path}', to_jsonb(p_to_key), true)
          ELSE item.value
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.attachments) = 'array' THEN c.attachments ELSE '[]'::jsonb END) AS item(value)
    ), updated_at = now()
    WHERE c.id = p_record_id
      AND public.athar_attachment_json_has_key(c.attachments, p_from_key);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN v_updated = 1;
END;
$function$;

-- A failed client-side DB commit may compensate a copied final object only
-- while no exact reference to it exists. This makes retry after a lost response
-- safe: a successfully committed final reference prevents deletion.
CREATE OR REPLACE FUNCTION public.athar_attachment_move_rollback_allowed(
  p_record_type text,
  p_record_id uuid,
  p_from_key text,
  p_to_key text,
  p_operation text,
  p_expected_state text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.athar_attachment_destination_can_modify(
           p_record_type, p_record_id, p_from_key, p_to_key, p_operation, p_expected_state
         )
    AND CASE p_record_type
      WHEN 'violation' THEN NOT EXISTS (
        SELECT 1 FROM public.violations v
        WHERE v.id = p_record_id
          AND (public.athar_attachment_json_has_key(v.attachments, p_to_key)
               OR public.athar_attachment_logs_have_key(v.logs, p_to_key))
      )
      WHEN 'complaint' THEN NOT EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.id = p_record_id
          AND (public.athar_attachment_json_has_key(c.attachments, p_to_key)
               OR public.athar_attachment_logs_have_key(c.logs, p_to_key))
      )
      ELSE false
    END;
$function$;

REVOKE ALL ON FUNCTION public.athar_attachment_can_read(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_user_can_see_attachment(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_can_modify(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_finalize_attachment_path(text, uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_move_rollback_allowed(text, uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_is_frozen_legacy_key(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.athar_attachment_new_references_are_valid(jsonb, jsonb, jsonb, jsonb, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.athar_guard_violation_attachment_references() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.athar_guard_complaint_attachment_references() FROM PUBLIC, anon, authenticated;

-- Pure validators are safe to use in the RLS-aware gate, but are not anonymous
-- endpoints. The stateful ledger helper stays unavailable to browser roles.
REVOKE ALL ON FUNCTION public.athar_attachment_json_has_key(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_logs_have_key(jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_key_is_valid(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_temp_key_is_owned(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.athar_attachment_key_is_canonical(text, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.athar_attachment_can_read(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.athar_user_can_see_attachment(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.athar_attachment_can_modify(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.athar_attachment_destination_can_modify(text, uuid, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.athar_finalize_attachment_path(text, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.athar_attachment_move_rollback_allowed(text, uuid, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.athar_attachment_json_has_key(jsonb, text) TO authenticated, service_role, athar_r2_read_gate;
GRANT EXECUTE ON FUNCTION public.athar_attachment_logs_have_key(jsonb, text) TO authenticated, service_role, athar_r2_read_gate;
GRANT EXECUTE ON FUNCTION public.athar_attachment_key_is_valid(text) TO authenticated, service_role, athar_r2_read_gate;
GRANT EXECUTE ON FUNCTION public.athar_attachment_temp_key_is_owned(text, uuid) TO authenticated, service_role, athar_r2_read_gate;
GRANT EXECUTE ON FUNCTION public.athar_attachment_key_is_canonical(text, text, uuid) TO authenticated, service_role, athar_r2_read_gate;

COMMIT;
