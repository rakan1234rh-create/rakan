-- Progressive per-user password reset rate limiting
-- Attempt 1: immediate
-- Attempt 2: 1 minute after previous
-- Attempt 3: 5 minutes
-- Attempt 4: 10 minutes
-- Attempt 5: 10 minutes (unspecified in product spec; same as attempt 4)
-- Attempt 6: 24 hours after previous
-- Attempt 7+: blocked — contact platform admin

create table if not exists public.password_reset_attempts (
  email_normalized text primary key,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.password_reset_attempts enable row level security;

revoke all on table public.password_reset_attempts from anon, authenticated;

create or replace function public._password_reset_cooldown_seconds(p_attempt_count integer)
returns integer
language sql
immutable
as $$
  select case p_attempt_count
    when 1 then 60
    when 2 then 300
    when 3 then 600
    when 4 then 600
    when 5 then 86400
    else null
  end;
$$;

create or replace function public.check_password_reset_rate_limit(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_row public.password_reset_attempts%rowtype;
  v_cooldown integer;
  v_elapsed numeric;
  v_wait integer;
begin
  if v_email is null or v_email = '' then
    return jsonb_build_object(
      'allowed', false,
      'wait_seconds', 0,
      'blocked', false,
      'message', 'البريد الإلكتروني غير صالح'
    );
  end if;

  select * into v_row
  from public.password_reset_attempts
  where email_normalized = v_email;

  if not found or v_row.attempt_count = 0 then
    return jsonb_build_object(
      'allowed', true,
      'wait_seconds', 0,
      'blocked', false,
      'next_attempt', 1
    );
  end if;

  if v_row.attempt_count >= 6 then
    return jsonb_build_object(
      'allowed', false,
      'wait_seconds', 0,
      'blocked', true,
      'next_attempt', v_row.attempt_count + 1,
      'message', 'تجاوزت الحد المسموح لإرسال رموز استعادة كلمة المرور. إذا كنت تواجه صعوبة في تسجيل الدخول، تواصل مع إدارة المنصة.'
    );
  end if;

  v_cooldown := public._password_reset_cooldown_seconds(v_row.attempt_count);

  if v_cooldown is null or v_row.last_sent_at is null then
    return jsonb_build_object(
      'allowed', false,
      'wait_seconds', 0,
      'blocked', true,
      'next_attempt', v_row.attempt_count + 1,
      'message', 'تجاوزت الحد المسموح لإرسال رموز استعادة كلمة المرور. إذا كنت تواجه صعوبة في تسجيل الدخول، تواصل مع إدارة المنصة.'
    );
  end if;

  v_elapsed := extract(epoch from (now() - v_row.last_sent_at));
  if v_elapsed < v_cooldown then
    v_wait := ceil(v_cooldown - v_elapsed)::integer;
    return jsonb_build_object(
      'allowed', false,
      'wait_seconds', v_wait,
      'blocked', false,
      'next_attempt', v_row.attempt_count + 1
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'wait_seconds', 0,
    'blocked', false,
    'next_attempt', v_row.attempt_count + 1
  );
end;
$$;

create or replace function public.record_password_reset_attempt(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' then
    return;
  end if;

  insert into public.password_reset_attempts (email_normalized, attempt_count, last_sent_at, updated_at)
  values (v_email, 1, now(), now())
  on conflict (email_normalized) do update
  set attempt_count = public.password_reset_attempts.attempt_count + 1,
      last_sent_at = now(),
      updated_at = now();
end;
$$;

create or replace function public.clear_password_reset_attempts(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' then
    return;
  end if;

  delete from public.password_reset_attempts
  where email_normalized = v_email;
end;
$$;

grant execute on function public.check_password_reset_rate_limit(text) to anon, authenticated;
grant execute on function public.record_password_reset_attempt(text) to anon, authenticated;
grant execute on function public.clear_password_reset_attempts(text) to anon, authenticated;
