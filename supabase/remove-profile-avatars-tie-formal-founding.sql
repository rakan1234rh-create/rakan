-- إزالة نهائية: ربطة عنق، رسمية، يوم التأسيس
update public.users
set avatar_key = null
where avatar_key in (
  'avatar_tie',
  'avatar_formal_f',
  'avatar_founding',
  'emp_tie',
  'mgr_tie',
  'sup_tie',
  'emp_formal_f',
  'mgr_formal_f',
  'sup_formal_f',
  'emp_founding',
  'mgr_founding',
  'sup_founding'
);

update public.platform_settings
set value = jsonb_build_object(
  'version', 2,
  'items', coalesce(
    (
      select jsonb_agg(elem order by elem->>'id')
      from jsonb_array_elements(value->'items') elem
      where elem->>'id' not in ('avatar_tie', 'avatar_formal_f', 'avatar_founding')
    ),
    '[]'::jsonb
  )
),
updated_at = now()
where key = 'profile_avatars_v1';
