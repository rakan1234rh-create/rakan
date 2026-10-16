-- Backfill legacy R2 object keys that predate the UUID-based record folders.
-- Only keys already referenced by a visible violation/complaint are recorded.
-- This does not grant access by itself; athar_attachment_can_read still applies
-- the normal record visibility predicate before consulting this ledger.
BEGIN;

INSERT INTO public.athar_r2_legacy_attachment_keys (record_type, record_id, object_key)
SELECT 'violation', v.id, COALESCE(item.value ->> 'p', item.value ->> 'path')
FROM public.violations AS v
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(v.attachments) = 'array'
       THEN v.attachments ELSE '[]'::jsonb END
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
FROM public.violations AS v
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(v.logs) = 'array'
       THEN v.logs ELSE '[]'::jsonb END
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
FROM public.complaints AS c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.attachments) = 'array'
       THEN c.attachments ELSE '[]'::jsonb END
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
FROM public.complaints AS c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.logs) = 'array'
       THEN c.logs ELSE '[]'::jsonb END
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

COMMIT;
