-- مسميات وظيفية ثابتة: موظف = أخصائي مبيعات، مدير فرع = مدير فرع
update public.users
set job_title = case
  when role::text = 'employee' then 'أخصائي مبيعات'
  when role::text = 'branch_manager' then 'مدير فرع'
  else null
end
where role::text in ('employee', 'branch_manager');

create or replace function public.sync_users_job_title()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role::text = 'employee' then
    new.job_title := 'أخصائي مبيعات';
  elsif new.role::text = 'branch_manager' then
    new.job_title := 'مدير فرع';
  else
    new.job_title := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_sync_job_title on public.users;
create trigger trg_users_sync_job_title
  before insert or update on public.users
  for each row
  execute function public.sync_users_job_title();

comment on column public.users.job_title is 'المسمى الوظيفي — يُزامَن تلقائياً للموظف ومدير الفرع';
