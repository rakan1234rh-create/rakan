-- اختبار تمرير تلقائي: V-2026-0317 — متبقي ~3 دقائق من مرحلة الموظف (emp → sup)
-- يُجدول pg_cron عند due_at عبر mirsad_enqueue_forward_job

do $$
declare
  v_id uuid;
  v_due timestamptz := now() + interval '3 minutes';
  v_ticket text := 'V-2026-0317';
begin
  select id into v_id
  from public.violations
  where ticket_number = v_ticket
     or ticket_number ilike '%-0317'
  order by case when ticket_number = v_ticket then 0 else 1 end
  limit 1;

  if v_id is null then
    raise exception 'لم تُعثر على التذكرة %', v_ticket;
  end if;

  -- تأكد أنها في مرحلة الموظف وجاهزة للتمرير
  update public.violations
  set
    state = 'emp',
    auto_forwarded_emp = false,
    auto_forwarded_sup = false,
    emp_forward_after = v_due,
    sup_forward_after = null,
    updated_at = now()
  where id = v_id;

  -- إعادة جدولة job (احتياط إن لم يُطلق الـ trigger)
  perform public.mirsad_enqueue_forward_job(v_id, 'emp_to_sup', v_due);
end;
$$;

-- تشخيص
select
  v.id,
  v.ticket_number,
  v.state,
  v.auto_forwarded_emp,
  v.emp_forward_after,
  v.emp_forward_after - now() as remaining,
  j.id as job_id,
  j.direction,
  j.due_at as job_due_at,
  j.status as job_status,
  j.cron_job_name,
  cj.schedule as cron_schedule
from public.violations v
left join public.violation_forward_jobs j
  on j.violation_id = v.id and j.direction = 'emp_to_sup' and j.status = 'pending'
left join cron.job cj on cj.jobname = j.cron_job_name
where v.ticket_number ilike '%0317'
order by v.ticket_number
limit 5;
