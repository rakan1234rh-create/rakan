-- صور الملف الشخصي — كتالوج ديناميكي لمدير النظام
-- شغّل بعد: rls_session_helpers.sql و platform_settings

alter table public.users drop constraint if exists users_avatar_key_check;
alter table public.users add constraint users_avatar_key_check check (
  avatar_key is null
  or avatar_key ~ '^[a-z][a-z0-9_]{1,63}$'
);

comment on column public.users.avatar_key is 'مفتاح صورة البروفايل — يُدار من platform_settings.profile_avatars_v1';

insert into public.platform_settings (key, value, updated_at)
values (
  'profile_avatars_v1',
  jsonb_build_object(
    'version', 1,
    'items', jsonb_build_array(
      jsonb_build_object('id','emp_ghutra','label','شماغ أحمر','img','portrait-ghutra.webp','imgSource','builtin','roles',jsonb_build_array('employee'),'founding',false),
      jsonb_build_object('id','emp_tie','label','ربطة عنق','img','portrait-tie-m.webp','imgSource','builtin','roles',jsonb_build_array('employee'),'founding',false),
      jsonb_build_object('id','emp_hijab','label','محجبة','img','portrait-hijab-f.webp','imgSource','builtin','roles',jsonb_build_array('employee'),'founding',false),
      jsonb_build_object('id','emp_formal_f','label','رسمية','img','portrait-formal-f.webp','imgSource','builtin','roles',jsonb_build_array('employee'),'founding',false),
      jsonb_build_object('id','emp_founding','label','يوم التأسيس','img','founding-day-sword.webp','imgSource','builtin','roles',jsonb_build_array('employee'),'founding',true),
      jsonb_build_object('id','mgr_ghutra','label','شماغ أحمر','img','portrait-ghutra.webp','imgSource','builtin','roles',jsonb_build_array('branch_manager'),'founding',false),
      jsonb_build_object('id','mgr_tie','label','ربطة عنق','img','portrait-tie-m.webp','imgSource','builtin','roles',jsonb_build_array('branch_manager'),'founding',false),
      jsonb_build_object('id','mgr_hijab','label','محجبة','img','portrait-hijab-f.webp','imgSource','builtin','roles',jsonb_build_array('branch_manager'),'founding',false),
      jsonb_build_object('id','mgr_formal_f','label','رسمية','img','portrait-formal-f.webp','imgSource','builtin','roles',jsonb_build_array('branch_manager'),'founding',false),
      jsonb_build_object('id','mgr_founding','label','يوم التأسيس','img','founding-day-sword.webp','imgSource','builtin','roles',jsonb_build_array('branch_manager'),'founding',true),
      jsonb_build_object('id','sup_ghutra','label','شماغ أحمر','img','portrait-ghutra.webp','imgSource','builtin','roles',jsonb_build_array('supervisor'),'founding',false),
      jsonb_build_object('id','sup_tie','label','ربطة عنق','img','portrait-tie-m.webp','imgSource','builtin','roles',jsonb_build_array('supervisor'),'founding',false),
      jsonb_build_object('id','sup_hijab','label','محجبة','img','portrait-hijab-f.webp','imgSource','builtin','roles',jsonb_build_array('supervisor'),'founding',false),
      jsonb_build_object('id','sup_formal_f','label','رسمية','img','portrait-formal-f.webp','imgSource','builtin','roles',jsonb_build_array('supervisor'),'founding',false),
      jsonb_build_object('id','sup_founding','label','يوم التأسيس','img','founding-day-sword.webp','imgSource','builtin','roles',jsonb_build_array('supervisor'),'founding',true)
    )
  ),
  now()
)
on conflict (key) do nothing;
