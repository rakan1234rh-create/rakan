-- إشعارات التطبيق للشكاوى والاقتراحات: جديدة / رد / حل أو قبول أو رفض (نفس أسلوب إشعارات المخالفات)
-- ملاحظة: notifications.ticket_id مربوط بجدول المخالفات، لذلك نرمّز رقم الشكوى داخل event_key:
--   cmpl_new_<id> | cmplr_<id> (رد) | cmpls_<id> (إغلاق)
create or replace function public.athar_notify_complaint_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_is_sug boolean := coalesce(NEW.kind, '') = 'suggestion';
  v_lbl text := case when coalesce(NEW.kind, '') = 'suggestion' then 'الاقتراح' else 'الشكوى' end;
  v_lbl_new text := case when coalesce(NEW.kind, '') = 'suggestion' then 'اقتراح' else 'شكوى' end;
  v_num text := coalesce(NEW.complaint_number, '');
  v_old_n int;
  v_new_n int;
  v_entry jsonb;
  v_uid uuid;
begin
  if TG_OP = 'INSERT' then
    for v_uid in
      select u.id from public.users u
      where u.role::text in ('admin', 'auditor') and coalesce(u.is_active, true)
        and u.id is distinct from NEW.employee_id
    loop
      perform public.athar_upsert_notification(
        v_uid, 'cmpl_new_' || NEW.id::text,
        'وصول ' || v_lbl_new || ' جديد',
        format('نفيدكم بوصول %s جديد برقم (%s). يُرجى الاطلاع والمتابعة.', v_lbl_new, v_num),
        'blue', 'fa-comment-dots', null, 'mine', false, null, null);
    end loop;
    return NEW;
  end if;

  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;

  v_old_n := jsonb_array_length(coalesce(OLD.logs, '[]'::jsonb));
  v_new_n := jsonb_array_length(coalesce(NEW.logs, '[]'::jsonb));

  /* رد جديد (غير رسائل النظام) */
  if v_new_n > v_old_n then
    v_entry := NEW.logs -> (v_new_n - 1);
    if coalesce(v_entry ->> 'is_system', '') <> 'true' then
      if coalesce(v_entry ->> 'is_admin', '') = 'true' then
        if NEW.employee_id is not null then
          perform public.athar_upsert_notification(
            NEW.employee_id, 'cmplr_' || NEW.id::text,
            'رد جديد على ' || v_lbl_new || 'كم',
            format('نفيدكم بوصول رد من الإدارة على %s رقم (%s). يُرجى الاطلاع على الرد.', v_lbl, v_num),
            'blue', 'fa-reply', null, 'mine', false, null, null);
        end if;
      else
        for v_uid in
          select u.id from public.users u
          where u.role::text in ('admin', 'auditor') and coalesce(u.is_active, true)
        loop
          perform public.athar_upsert_notification(
            v_uid, 'cmplr_' || NEW.id::text,
            'رد جديد على ' || v_lbl_new,
            format('نفيدكم بقيام صاحب %s رقم (%s) بالرد. يُرجى الاطلاع ومتابعة الإجراء.', v_lbl_new, v_num),
            'blue', 'fa-reply', null, 'mine', false, null, null);
        end loop;
      end if;
    end if;
  end if;

  /* إغلاق: حل الشكوى / قبول أو رفض الاقتراح */
  if NEW.status is distinct from OLD.status and NEW.status in ('resolved', 'rejected') and NEW.employee_id is not null then
    perform public.athar_upsert_notification(
      NEW.employee_id, 'cmpls_' || NEW.id::text,
      case when NEW.status = 'rejected' then 'تم رفض اقتراحكم'
           when v_is_sug then 'تم قبول اقتراحكم'
           else 'تم حل شكواكم' end,
      case when NEW.status = 'rejected' then format('نفيدكم بصدور قرار الإدارة برفض الاقتراح رقم (%s).', v_num)
           when v_is_sug then format('نفيدكم بقبول الإدارة للاقتراح رقم (%s). شكراً لمشاركتكم.', v_num)
           else format('نفيدكم بإغلاق الشكوى رقم (%s) بعد معالجتها.', v_num) end,
      case when NEW.status = 'rejected' then 'red' else 'green' end,
      case when NEW.status = 'rejected' then 'fa-circle-xmark' else 'fa-circle-check' end,
      null, 'mine', false, null, null);
  end if;

  return NEW;
end;
$function$;

drop trigger if exists athar_complaint_notify_trg on public.complaints;
create trigger athar_complaint_notify_trg
  after insert or update on public.complaints
  for each row execute function public.athar_notify_complaint_change();
