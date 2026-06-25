alter table public.users drop constraint if exists users_avatar_key_check;
alter table public.users add constraint users_avatar_key_check check (
  avatar_key is null
  or avatar_key in (
    'emp_ghutra',
    'emp_tie',
    'emp_hijab',
    'emp_formal_f',
    'emp_founding',
    'mgr_ghutra',
    'mgr_tie',
    'mgr_hijab',
    'mgr_formal_f',
    'mgr_founding',
    'sup_ghutra',
    'sup_tie',
    'sup_hijab',
    'sup_formal_f',
    'sup_founding'
  )
);
