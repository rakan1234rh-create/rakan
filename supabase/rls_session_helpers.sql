-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد (Mirsad) — دوال «جلسة» المستخدم لسياسات RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- المنصة تتوقع في public.users:
--   id uuid (المفتاح المحلي للمستخدم)
--   auth_uid uuid (يربط صف users بـ auth.users.id من Supabase Auth)
--   role — إما enum user_role أو text بالقيم: admin, manager, auditor, supervisor, employee, observer
--   is_active boolean
--
-- شغّل الملف من SQL Editor بعد تعديل نوع العمود إن لزم (قسم «خياران» أدناه).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) نوع enum للأدوار (إن وُجد مسبقاً يُتخطى) ───
do $$
begin
  create type public.user_role as enum (
    'admin',
    'manager',
    'auditor',
    'supervisor',
    'employee',
    'observer'
  );
exception
  when duplicate_object then null;
end$$;

-- ─── 2) دوال الجلسة (SECURITY DEFINER + search_path ثابت) ───

-- معرّف المستخدم في جدول public.users المرتبط بالجلسة الحالية
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from public.users u
  where u.auth_uid = auth.uid()
  limit 1;
$$;

-- الدور كنص (للسياسات التي تقارن بـ current_user_role() = 'admin'::text)
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role::text
  from public.users u
  where u.auth_uid = auth.uid()
  limit 1;
$$;

-- نشط؟ (للسياسات current_user_is_active())
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select u.is_active from public.users u where u.auth_uid = auth.uid() limit 1),
    false
  );
$$;

-- نفس الدور كـ user_role (للسياسات get_user_role() = 'admin'::user_role)
-- يعمل إذا كان عمود users.role من نوع user_role أو text بقيم تطابق الـ enum
create or replace function public.get_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role::public.user_role
  from public.users u
  where u.auth_uid = auth.uid()
  limit 1;
$$;

-- فروع المناطق التي يشرف عليها المستخدم الحالي (مشرف) — لسياسات violations للمشرف
create or replace function public.current_user_supervised_branches()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    array_agg(b.id) filter (where b.id is not null),
    '{}'::uuid[]
  )
  from public.regions r
  join public.branches b on b.region_id = r.id
  where r.supervisor_id = public.current_user_id();
$$;

-- صلاحيات التنفيذ لدور PostgREST
grant execute on function public.current_user_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_is_active() to authenticated;
grant execute on function public.get_user_role() to authenticated;
grant execute on function public.current_user_supervised_branches() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- خياران لعمود users.role (اختر ما ينطبق على قاعدتك)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- (أ) العمود أصلاً من نوع public.user_role — لا تغيّر شيئاً؛ الدوال أعلاه كافية.
--
-- (ب) العمود text وتريد توحيده مع enum السياسات:
--     alter table public.users
--       alter column role type public.user_role using role::public.user_role;
--
-- إن بقي text فقط، بسّط سياساتك لتستخدم current_user_role() فقط وأزل get_user_role()
-- أو عرّف get_user_role() كـ returns text بدلاً من user_role (يتطلب تعديل سياساتك).
-- ═══════════════════════════════════════════════════════════════════════════

-- تحقق سريع (شغّل وأنت مسجّل من الواجهة أو عيّن JWT في REST):
-- select auth.uid() as jwt_sub, public.current_user_id() as app_user, public.current_user_role() as role_txt,
--        public.current_user_is_active() as active, public.get_user_role() as role_enum,
--        public.current_user_supervised_branches() as sup_branches;
