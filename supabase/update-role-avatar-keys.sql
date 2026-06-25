-- أيقونات أدوار بدل صور الوجوه
update public.users set avatar_key = null where avatar_key is not null;

alter table public.users drop constraint if exists users_avatar_key_check;
alter table public.users add constraint users_avatar_key_check check (
  avatar_key is null
  or avatar_key in (
    'emp_sales',
    'emp_target',
    'emp_chat',
    'emp_star',
    'mgr_store',
    'mgr_team',
    'mgr_chart',
    'mgr_key',
    'sup_map',
    'sup_regions',
    'sup_eye',
    'sup_flag'
  )
);

comment on column public.users.avatar_key is 'مفتاح أيقونة الدور — موظف / مدير فرع / مشرف';
