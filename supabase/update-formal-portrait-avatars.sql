-- صور رسمية بزي خليجي لكل دور
update public.users set avatar_key = null where avatar_key is not null;

alter table public.users drop constraint if exists users_avatar_key_check;
alter table public.users add constraint users_avatar_key_check check (
  avatar_key is null
  or avatar_key in (
    'emp_ghutra',
    'emp_tie',
    'emp_hijab',
    'emp_formal_f',
    'mgr_ghutra',
    'mgr_tie',
    'mgr_hijab',
    'mgr_formal_f',
    'sup_ghutra',
    'sup_tie',
    'sup_hijab',
    'sup_formal_f'
  )
);

comment on column public.users.avatar_key is 'صورة رمزية رسمية — شماغ / ربطة / محجبة / رسمية لكل دور';
