-- إزالة نهائية: شماغ أحمر + محجبة (مدمجة)
update public.users
set avatar_key = null
where avatar_key in (
  'avatar_ghutra',
  'avatar_hijab',
  'emp_ghutra',
  'mgr_ghutra',
  'sup_ghutra',
  'emp_hijab',
  'mgr_hijab',
  'sup_hijab'
);

update public.platform_settings
set value = jsonb_build_object(
  'version', 2,
  'items', coalesce(
    (
      select jsonb_agg(elem order by elem->>'id')
      from jsonb_array_elements(value->'items') elem
      where elem->>'id' not in ('avatar_ghutra', 'avatar_hijab')
        and elem->>'id' not like 'emp\_%' escape '\'
        and elem->>'id' not like 'mgr\_%' escape '\'
        and elem->>'id' not like 'sup\_%' escape '\'
    ),
    '[]'::jsonb
  )
),
updated_at = now()
where key = 'profile_avatars_v1';
