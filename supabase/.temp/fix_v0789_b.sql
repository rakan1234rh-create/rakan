UPDATE public.violations v
SET
  state = 'closed',
  status_text = convert_from(decode('d985d984d8bad8a7d8a920d8a8d982d8b1d8a7d8b120d8a7d984d8aad8afd982d98ad982', 'hex'), 'UTF8'),
  logs = (
    SELECT COALESCE(jsonb_agg(fixed ORDER BY ord), '[]'::jsonb)
    FROM (
      SELECT
        ord,
        CASE
          WHEN ord = (SELECT MAX(ord2) FROM jsonb_array_elements(COALESCE(v.logs::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t2(e2, ord2))
            AND elem->>'role' = convert_from(decode('d8a7d984d8aad8afd982d98ad982', 'hex'), 'UTF8')
          THEN jsonb_build_object(
            'date', elem->>'date',
            'user', elem->>'user',
            'role', elem->>'role',
            'action', convert_from(decode('d8a5d984d8bad8a7d8a12028d8a7d984d8aad8afd982d98ad98229', 'hex'), 'UTF8'),
            'note', COALESCE(elem->>'note', '')
              || E'\n'
              || convert_from(decode('28d8aad8b5d8add98ad8ad3a20d983d8a7d98620d8a7d8b9d8aad985d8a7d8afd8a7d98b20d8a8d8a7d984d8aed8b7d8a320d988d8aad98520d8aad8add988d98ad984d98720d8a5d984d98920d8a5d984d8bad8a7d8a120d985d98620d8a7d984d8aad8afd982d98ad98229', 'hex'), 'UTF8')
          )
          ELSE elem
        END AS fixed
      FROM jsonb_array_elements(COALESCE(v.logs::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
    ) s
  ),
  updated_at = timezone('utc', now())
WHERE v.ticket_number = 'V-2026-0789'
  AND v.id = '7e376caf-a028-4670-94b4-fa33636fb56f'
RETURNING v.ticket_number, v.state, v.status_text, encode(convert_to(v.status_text, 'UTF8'), 'hex') AS status_hex, v.logs->-1 AS last_log;
