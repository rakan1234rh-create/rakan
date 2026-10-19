-- Clean only the legacy attachment references approved for removal.
-- The uniqueness trigger is paused within this transaction because the old
-- duplicate references are the data being repaired.
BEGIN;

DROP TRIGGER IF EXISTS athar_guard_unique_violation_attachment_paths_trg ON public.violations;

WITH cleaned AS (
  SELECT
    v.id,
    CASE v.ticket_number
      WHEN 'V-2026-0882' THEN (
        SELECT COALESCE(jsonb_agg(item ORDER BY ord), '[]'::jsonb)
        FROM (
          SELECT item, ord,
                 row_number() OVER (PARTITION BY item->>'n' ORDER BY ord) AS occurrence
          FROM jsonb_array_elements(COALESCE(v.attachments, '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
        ) d
        WHERE occurrence = 1
      )
      WHEN 'V-2026-0885' THEN (
        SELECT COALESCE(jsonb_agg(item ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(v.attachments, '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
        WHERE item->>'p' <> 'temp_0db50bb5-0921-4bbc-90bf-98f65994ad88_1792305179774_qwgjp/c7daa8b50e3b_03-KHA-Khafji_Camera_01_03-KHA-Khafji_20261018093000_214350205.webp'
      )
      WHEN 'V-2026-0888' THEN (
        SELECT COALESCE(jsonb_agg(item ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(v.attachments, '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
        WHERE item->>'p' NOT IN (
          'temp_d49acee3-c4ea-4c76-82af-b6d9ed04d4ec_1792335033671_62r4r/0e68dec2fbac_1.webp',
          'temp_d49acee3-c4ea-4c76-82af-b6d9ed04d4ec_1792335033671_62r4r/2306b5fbc8b0_2.webp',
          'temp_d49acee3-c4ea-4c76-82af-b6d9ed04d4ec_1792335033671_62r4r/fe50e1d2ee59_3.jpeg'
        )
      )
      WHEN 'V-2026-0890' THEN (
        SELECT COALESCE(jsonb_agg(item ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(v.attachments, '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
        WHERE item->>'p' <> 'temp_d49acee3-c4ea-4c76-82af-b6d9ed04d4ec_1792349161539_72tlm/7b54efd01340_03-AHS-AlOthaimMall_show_room_03_03-AHS-AlOthaimMall_20261018212850_20261018213150_99356867.mp4'
      )
      WHEN 'V-2026-0891' THEN (
        SELECT COALESCE(jsonb_agg(item ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(v.attachments, '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
        WHERE item->>'p' NOT IN (
          'temp_d49acee3-c4ea-4c76-82af-b6d9ed04d4ec_1792349161539_72tlm/7b54efd01340_03-AHS-AlOthaimMall_show_room_03_03-AHS-AlOthaimMall_20261018212850_20261018213150_99356867.mp4',
          'temp_d49acee3-c4ea-4c76-82af-b6d9ed04d4ec_1792356586863_7jr0a/d1f537987807_03-AHS-Al-Ahsa-Mall_IPCamera_02_03-AHS-Al-Ahsa-Mall_20261018234649_20261018234715_5871086.mp4',
          'temp_d49acee3-c4ea-4c76-82af-b6d9ed04d4ec_1792356586863_7jr0a/e92de6c54bac__2026-10-18_234823.png'
        )
      )
      ELSE v.attachments
    END AS attachments
  FROM public.violations v
  WHERE v.ticket_number IN ('V-2026-0882','V-2026-0885','V-2026-0888','V-2026-0890','V-2026-0891')
)
UPDATE public.violations v
SET attachments = cleaned.attachments
FROM cleaned
WHERE v.id = cleaned.id;

CREATE TRIGGER athar_guard_unique_violation_attachment_paths_trg
  BEFORE INSERT OR UPDATE OF attachments ON public.violations
  FOR EACH ROW
  EXECUTE FUNCTION public.athar_guard_unique_violation_attachment_paths();

COMMIT;
