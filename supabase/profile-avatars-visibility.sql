-- إضافة حقول العرض/الإخفاء وشارة «جديد» لكتالوج صور البروفايل
update public.platform_settings
set value = jsonb_set(
  value,
  '{items}',
  coalesce(
    (
      select jsonb_agg(
        elem
        || jsonb_build_object('visible', coalesce((elem->>'visible')::boolean, true))
        || jsonb_build_object('newUntil', elem->'newUntil')
        order by elem->>'id'
      )
      from jsonb_array_elements(value->'items') elem
    ),
    '[]'::jsonb
  )
),
updated_at = now()
where key = 'profile_avatars_v1';
