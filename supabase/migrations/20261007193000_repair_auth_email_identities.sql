-- Repair missing auth.identities after project migration.
-- Without an email identity, signInWithPassword returns invalid credentials
-- even when email/password hashes in auth.users are correct.

INSERT INTO auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  coalesce(u.last_sign_in_at, u.created_at),
  coalesce(u.created_at, now()),
  coalesce(u.updated_at, now())
FROM auth.users u
WHERE u.email IS NOT NULL
  AND length(trim(u.email)) > 0
  AND u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM auth.identities i
    WHERE i.user_id = u.id
      AND i.provider = 'email'
  );
