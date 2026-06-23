-- تحقق سريع: V-2026-0317 (emp أو sup forward)
select
  v.ticket_number,
  v.state,
  v.auto_forwarded_emp,
  v.auto_forwarded_sup,
  v.emp_forward_after,
  v.sup_forward_after,
  coalesce(
    round(extract(epoch from (v.emp_forward_after - now())) / 60.0, 1),
    round(extract(epoch from (v.sup_forward_after - now())) / 60.0, 1)
  ) as minutes_remaining,
  j.direction,
  j.status as job_status,
  j.due_at as job_due_at,
  j.cron_job_name,
  cj.schedule as cron_schedule
from public.violations v
left join public.violation_forward_jobs j
  on j.violation_id = v.id and j.status = 'pending'
left join cron.job cj on cj.jobname = j.cron_job_name
where v.ticket_number ilike '%0317'
limit 3;
