UPDATE public.violations
SET
  state = 'closed',
  status_text = 'ملغاة بقرار التدقيق',
  logs = (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN ord = n
          AND elem->>'role' = 'التدقيق'
          AND elem->>'action' = 'إفادة التدقيق'
        THEN jsonb_set(
          jsonb_set(elem, '{action}', '"إلغاء (التدقيق)"'::jsonb, true),
          '{note}',
          to_jsonb(
            COALESCE(elem->>'note', '')
            || E'\n(تصحيح: كان اعتماداً بالخطأ وتم تحويله إلى إلغاء من التدقيق)'
          ),
          true
        )
        ELSE elem
      END
      ORDER BY ord
    ), '[]'::jsonb)
    FROM (
      SELECT elem, ord, COUNT(*) OVER () AS n
      FROM jsonb_array_elements(COALESCE(logs::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
    ) x
  ),
  updated_at = timezone('utc', now())
WHERE ticket_number = 'V-2026-0789'
  AND id = '7e376caf-a028-4670-94b4-fa33636fb56f'
RETURNING ticket_number, state, status_text, left(audit_reply, 80) AS audit_reply, logs->-1 AS last_log;
