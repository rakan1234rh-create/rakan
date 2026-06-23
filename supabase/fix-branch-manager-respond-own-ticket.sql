-- تفعيل respond_own_ticket لمدير الفرع في إعدادات الصلاحيات المحفوظة
-- (كان false رغم أن المخالفة قد تُسجَّل على مدير الفرع شخصياً — مثل V-2026-0319)

UPDATE platform_settings
SET value = jsonb_set(value, '{branch_manager,respond_own_ticket}', 'true'::jsonb, true),
    updated_at = now()
WHERE key = 'role_permissions'
  AND (value->'branch_manager'->>'respond_own_ticket') = 'false';

UPDATE platform_settings
SET value = jsonb_set(
      jsonb_set(value, '{roles,branch_manager,respond_own_ticket}', 'true'::jsonb, true),
      '{updatedAt}',
      to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      true
    ),
    updated_at = now()
WHERE key = 'permissions_bundle_v1'
  AND (value->'roles'->'branch_manager'->>'respond_own_ticket') = 'false';
