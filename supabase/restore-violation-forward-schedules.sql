-- استعادة مواعيد التمرير التلقائي الرسمية لجميع المخالفات
-- emp: created_at + 24 ساعة | sup: بداية مرحلة المشرف + 48 ساعة

-- إلغاء كل jobs المعلّقة و cron المرتبطة
do $$
declare
  j record;
begin
  for j in
    select id, cron_job_name
    from public.violation_forward_jobs
    where status = 'pending'
  loop
    if j.cron_job_name is not null then
      perform public.mirsad_unschedule_forward_cron(j.cron_job_name);
    end if;
  end loop;

  update public.violation_forward_jobs
  set status = 'cancelled', processed_at = now(), cron_job_name = null
  where status = 'pending';
end;
$$;

-- مسح مواعيد غير مناسبة للحالة الحالية
update public.violations
set emp_forward_after = null
where state <> 'emp' or coalesce(auto_forwarded_emp, false);

update public.violations
set sup_forward_after = null
where state <> 'sup'
   or coalesce(auto_forwarded_sup, false)
   or public.mirsad_workflow_stage_skipped('sup');

-- إعادة حساب المواعيد الرسمية
update public.violations v
set emp_forward_after = v.created_at + interval '24 hours'
where v.state = 'emp'
  and coalesce(v.auto_forwarded_emp, false) = false;

update public.violations v
set sup_forward_after =
  public.mirsad_sup_stage_start_time(v.logs, v.auto_forwarded_emp, v.updated_at, v.created_at)
  + interval '48 hours'
where v.state = 'sup'
  and coalesce(v.auto_forwarded_sup, false) = false
  and not public.mirsad_workflow_stage_skipped('sup')
  and public.mirsad_sup_stage_start_time(v.logs, v.auto_forwarded_emp, v.updated_at, v.created_at) is not null;

-- إعادة جدولة jobs + pg_cron
do $$
declare
  r record;
begin
  for r in
    select id, emp_forward_after
    from public.violations
    where state = 'emp'
      and coalesce(auto_forwarded_emp, false) = false
      and emp_forward_after is not null
  loop
    perform public.mirsad_enqueue_forward_job(r.id, 'emp_to_sup', r.emp_forward_after);
  end loop;

  for r in
    select id, sup_forward_after
    from public.violations
    where state = 'sup'
      and coalesce(auto_forwarded_sup, false) = false
      and sup_forward_after is not null
      and not public.mirsad_workflow_stage_skipped('sup')
  loop
    perform public.mirsad_enqueue_forward_job(r.id, 'sup_to_aud', r.sup_forward_after);
  end loop;
end;
$$;

-- ملخص
select
  count(*) filter (where state = 'emp' and emp_forward_after is not null) as emp_scheduled,
  count(*) filter (where state = 'sup' and sup_forward_after is not null) as sup_scheduled,
  (select count(*) from public.violation_forward_jobs where status = 'pending' and direction = 'emp_to_sup') as emp_jobs,
  (select count(*) from public.violation_forward_jobs where status = 'pending' and direction = 'sup_to_aud') as sup_jobs
from public.violations;

select
  v.ticket_number,
  v.state,
  v.emp_forward_after,
  v.sup_forward_after,
  j.direction,
  j.due_at,
  j.status,
  j.cron_job_name
from public.violations v
left join public.violation_forward_jobs j
  on j.violation_id = v.id and j.status = 'pending'
where v.ticket_number ilike '%0317'
   or v.state in ('emp', 'sup')
order by v.ticket_number, j.direction
limit 30;
