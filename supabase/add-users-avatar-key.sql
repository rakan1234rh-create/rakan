-- صورة رمزية محددة مسبقاً (مفتاح من قائمة التطبيق)
alter table public.users add column if not exists avatar_key text;

comment on column public.users.avatar_key is 'مفتاح الصورة الرمزية المختارة من القائمة الثابتة';

alter table public.users drop constraint if exists users_avatar_key_check;
alter table public.users add constraint users_avatar_key_check check (
  avatar_key is null
  or avatar_key in (
    'male_blue',
    'glasses_purple',
    'headphones_green',
    'male_tie',
    'female_hijab',
    'female_hair',
    'female_glasses',
    'female_tie'
  )
);
