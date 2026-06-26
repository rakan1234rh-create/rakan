-- توحيد كتالوج صور البروفايل (صورة واحدة لكل أدوار) + ترحيل avatar_key
update public.users set avatar_key = 'avatar_ghutra' where avatar_key in ('emp_ghutra', 'mgr_ghutra', 'sup_ghutra');
update public.users set avatar_key = 'avatar_tie' where avatar_key in ('emp_tie', 'mgr_tie', 'sup_tie');
update public.users set avatar_key = 'avatar_hijab' where avatar_key in ('emp_hijab', 'mgr_hijab', 'sup_hijab');
update public.users set avatar_key = 'avatar_formal_f' where avatar_key in ('emp_formal_f', 'mgr_formal_f', 'sup_formal_f');
update public.users set avatar_key = 'avatar_founding' where avatar_key in ('emp_founding', 'mgr_founding', 'sup_founding');

update public.platform_settings
set value = jsonb_build_object(
  'version', 2,
  'items', jsonb_build_array(
    jsonb_build_object('id','avatar_ghutra','label','شماغ أحمر','img','portrait-ghutra.webp','imgSource','builtin','roles',jsonb_build_array('employee','branch_manager','supervisor'),'founding',false,'posX',50,'posY',42),
    jsonb_build_object('id','avatar_tie','label','ربطة عنق','img','portrait-tie-m.webp','imgSource','builtin','roles',jsonb_build_array('employee','branch_manager','supervisor'),'founding',false,'posX',50,'posY',40),
    jsonb_build_object('id','avatar_hijab','label','محجبة','img','portrait-hijab-f.webp','imgSource','builtin','roles',jsonb_build_array('employee','branch_manager','supervisor'),'founding',false,'posX',50,'posY',38),
    jsonb_build_object('id','avatar_formal_f','label','رسمية','img','portrait-formal-f.webp','imgSource','builtin','roles',jsonb_build_array('employee','branch_manager','supervisor'),'founding',false,'posX',50,'posY',40),
    jsonb_build_object('id','avatar_founding','label','يوم التأسيس','img','founding-day-sword.webp','imgSource','builtin','roles',jsonb_build_array('employee','branch_manager','supervisor'),'founding',true,'posX',50,'posY',48)
  )
),
updated_at = now()
where key = 'profile_avatars_v1';
