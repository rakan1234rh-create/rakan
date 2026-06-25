-- المسمى الوظيفي للموظف ومدير الفرع (عرض في صفحة البروفايل)
alter table public.users add column if not exists job_title text;

comment on column public.users.job_title is 'المسمى الوظيفي — للموظف ومدير الفرع';
