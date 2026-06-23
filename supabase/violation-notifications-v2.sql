-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — إشعارات المخالفات v2 (الخطة الرسمية 2026)
-- • نصوص رسمية لكل مرحلة وقرار
-- • حذف نهائي من notifications بعد 24 ساعة (مخالفات فقط)
-- شغّل في Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema pg_catalog;

-- ─── مساعد: إرسال تنبيه واحد ───
create or replace function public.athar_notif_emit(
  p_user_id uuid,
  p_event_suffix text,
  p_violation_id uuid,
  p_title text,
  p_message text,
  p_type text default 'amber',
  p_icon text default 'fa-bell',
  p_scope text default 'mine',
  p_is_auto boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or coalesce(trim(p_event_suffix), '') = '' then
    return;
  end if;
  perform public.athar_upsert_notification(
    p_user_id,
    trim(p_event_suffix) || '_' || p_violation_id::text,
    p_title,
    p_message,
    coalesce(nullif(trim(p_type), ''), 'amber'),
    coalesce(nullif(trim(p_icon), ''), 'fa-bell'),
    p_violation_id,
    coalesce(nullif(trim(p_scope), ''), 'mine'),
    coalesce(p_is_auto, false),
    null,
    null
  );
end;
$$;

-- ─── مساعد: اسم الموظف ───
create or replace function public.athar_notif_emp_name(p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(trim(u.name), ''), 'الموظف')
  from public.users u
  where u.id = p_employee_id
  limit 1;
$$;

-- ─── مساعد: إشعار مشرفي المنطقة ───
create or replace function public.athar_notif_emit_supervisor(
  p_branch_id uuid,
  p_violation_id uuid,
  p_employee_id uuid,
  p_event_suffix text,
  p_title text,
  p_message text,
  p_type text default 'blue',
  p_icon text default 'fa-bell',
  p_is_auto boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  if p_branch_id is null then return; end if;
  v_uid := public.athar_region_supervisor_id(p_branch_id);
  if v_uid is null or (p_employee_id is not null and v_uid = p_employee_id) then return; end if;
  perform public.athar_notif_emit(
    v_uid, p_event_suffix, p_violation_id, p_title, p_message,
    p_type, p_icon, 'team', p_is_auto
  );
end;
$$;

-- ─── مساعد: إشعار مديري الفرع ───
create or replace function public.athar_notif_emit_branch_managers(
  p_branch_id uuid,
  p_violation_id uuid,
  p_employee_id uuid,
  p_event_suffix text,
  p_title text,
  p_message text,
  p_type text default 'amber',
  p_icon text default 'fa-clipboard-list',
  p_is_auto boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  if p_branch_id is null then return; end if;
  for v_uid in
    select u.id from public.users u
    where u.branch_id = p_branch_id
      and u.role = 'branch_manager'
      and coalesce(u.is_active, true)
      and (p_employee_id is null or u.id <> p_employee_id)
  loop
    perform public.athar_notif_emit(
      v_uid, p_event_suffix, p_violation_id, p_title, p_message,
      p_type, p_icon, 'team', p_is_auto
    );
  end loop;
end;
$$;

-- ─── مساعد: إشعار حسب الدور ───
create or replace function public.athar_notif_emit_role(
  p_roles text[],
  p_violation_id uuid,
  p_event_suffix text,
  p_title text,
  p_message text,
  p_type text default 'blue',
  p_icon text default 'fa-bell',
  p_is_auto boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  for v_uid in
    select u.id from public.users u
    where u.role::text = any(p_roles)
      and coalesce(u.is_active, true)
  loop
    perform public.athar_notif_emit(
      v_uid, p_event_suffix, p_violation_id, p_title, p_message,
      p_type, p_icon, 'mine', p_is_auto
    );
  end loop;
end;
$$;

-- ─── 🛑 أولاً: رصد مخالفة جديدة ───
create or replace function public.athar_notify_violation_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket text;
  v_emp text;
  v_vtype text;
begin
  if NEW.state = 'uploading' then
    return NEW;
  end if;

  v_ticket := public.athar_short_ticket_num(NEW.ticket_number);
  v_vtype := coalesce(nullif(trim(NEW.violation_type), ''), '—');
  v_emp := public.athar_notif_emp_name(NEW.employee_id);

  if NEW.employee_id is not null then
    perform public.athar_notif_emit(
      NEW.employee_id, 'vnew_emp', NEW.id,
      'تم تسجيل مخالفة بحقك',
      format(
        'نفيدكم بتسجيل مخالفة بحقكم برقم مرجعي (%s). نوع المخالفة: %s. يُرجى تقديم الإفادة عبر النظام خلال 24 ساعة؛ تجنباً للتمرير التلقائي.',
        v_ticket, v_vtype
      ),
      'amber', 'fa-bell', 'mine', false
    );
  end if;

  perform public.athar_notif_emit_supervisor(
    NEW.branch_id, NEW.id, NEW.employee_id, 'vnew_sup',
    'رصد مخالفة ضمن منطقتكم',
    format(
      'نفيدكم برصد مخالفة برقم (%s) على الموظف: %s، ضمن نطاق إشرافكم. نوع المخالفة: %s. للإحاطة ومتابعة استكمال الإجراءات.',
      v_ticket, v_emp, v_vtype
    ),
    'blue', 'fa-bell', false
  );

  perform public.athar_notif_emit_branch_managers(
    NEW.branch_id, NEW.id, NEW.employee_id, 'vnew_bm',
    'رصد مخالفة تحت إدارتكم',
    format(
      'نفيدكم بقيد مخالفة برقم (%s) على الموظف: %s، التابع لإدارتكم. نوع المخالفة: %s. للاطلاع ومتابعة سير الإجراء.',
      v_ticket, v_emp, v_vtype
    ),
    'amber', 'fa-clipboard-list', false
  );

  return NEW;
end;
$$;

-- ─── تنبيهات تغيّر المرحلة / القرار ───
create or replace function public.athar_notify_violation_state_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket text;
  v_emp text;
  v_vtype text;
  v_old text;
  v_new text;
  v_st text;
  v_auto_emp boolean;
  v_auto_sup boolean;
  v_is_warn boolean;
  v_is_cancelled boolean;
  v_is_approved boolean;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;
  if current_setting('athar.notif_backfill', true) is distinct from '1'
     and NEW.state is not distinct from OLD.state
     and NEW.status_text is not distinct from OLD.status_text then
    return NEW;
  end if;

  v_old := coalesce(OLD.state::text, '');
  v_new := coalesce(NEW.state::text, '');
  v_ticket := public.athar_short_ticket_num(NEW.ticket_number);
  v_vtype := coalesce(nullif(trim(NEW.violation_type), ''), '—');
  v_emp := public.athar_notif_emp_name(NEW.employee_id);
  v_st := coalesce(NEW.status_text, '');
  v_auto_emp := coalesce(NEW.auto_forwarded_emp, false);
  v_auto_sup := coalesce(NEW.auto_forwarded_sup, false);
  v_is_warn := v_st ~* 'تنبيه|اكتفاء بالتنبيه|Warning_Issued';
  v_is_cancelled := v_st ~* 'ملغ|مرفوض';
  v_is_approved := v_st ~* 'معتمد' and not v_is_warn;

  -- ✉️ رد الموظف emp → sup
  if v_old = 'emp' and v_new = 'sup' and not v_auto_emp then
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'emp_resp_sup',
      'تم تقديم الإفادة على مخالفة ضمن منطقتكم',
      format(
        'نفيدكم بأن الموظف: %s قام بتقديم الإفادة على المخالفة رقم (%s) من نوع: %s. يُرجى الاطلاع ومتابعة استكمال الإجراءات.',
        v_emp, v_ticket, v_vtype
      ),
      'blue', 'fa-reply', false
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'emp_resp_bm',
      'تم الرد على مخالفة تحت إدارتكم',
      format(
        'نفيدكم بأن الموظف: %s التابع لإدارتكم، قد قام بتقديم الإفادة على المخالفة رقم (%s) من نوع: %s. يُرجى الاطلاع ومراجعة الرد.',
        v_emp, v_ticket, v_vtype
      ),
      'blue', 'fa-reply', false
    );
    return NEW;
  end if;

  -- ⏳ تمرير تلقائي emp → sup
  if v_old = 'emp' and v_new = 'sup' and v_auto_emp then
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'auto_emp_sup',
      'تم تمرير مخالفة تلقائياً ضمن منطقتكم',
      format(
        'نفيدكم بتمرير المخالفة رقم (%s) تلقائياً لعدم الرد خلال المهلة المحددة، على الموظف: %s ضمن نطاق إشرافكم. نوع المخالفة: %s. للإحاطة ومتابعة الإجراء.',
        v_ticket, v_emp, v_vtype
      ),
      'amber', 'fa-robot', true
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'auto_emp_bm',
      'تم تمرير مخالفة تلقائياً تحت إدارتكم',
      format(
        'نفيدكم بتمرير المخالفة رقم (%s) تلقائياً لعدم الرد خلال المهلة المحددة، على الموظف: %s التابع لإدارتكم. نوع المخالفة: %s. للاطلاع ومتابعة سير الإجراء.',
        v_ticket, v_emp, v_vtype
      ),
      'amber', 'fa-robot', true
    );
    return NEW;
  end if;

  -- 🔍 رد المشرف sup → aud
  if v_old = 'sup' and v_new = 'aud' and not v_auto_sup then
    perform public.athar_notif_emit_role(
      array['auditor', 'admin'], NEW.id, 'sup_ref_aud',
      'إحالة مخالفة للتدقيق',
      format(
        'نفيدكم بإحالة المخالفة رقم (%s) لتدقيقكم بعد استكمال إجراءات المشرف، للموظف: %s. نوع المخالفة: %s. يُرجى الاطلاع ومراجعة الإجراء.',
        v_ticket, v_emp, v_vtype
      ),
      'purple', 'fa-bell', false
    );
    return NEW;
  end if;

  -- تمرير تلقائي sup → aud
  if v_old = 'sup' and v_new = 'aud' and v_auto_sup then
    perform public.athar_notif_emit_role(
      array['auditor', 'admin'], NEW.id, 'auto_sup_aud',
      'تم تمرير مخالفة تلقائياً لتدقيقكم',
      format(
        'نفيدكم بتمرير المخالفة رقم (%s) تلقائياً لتدقيقكم لعدم اتخاذ إجراء من قِبل المشرف خلال المهلة، للموظف: %s. نوع المخالفة: %s. يُرجى الاطلاع والاعتماد.',
        v_ticket, v_emp, v_vtype
      ),
      'purple', 'fa-robot', true
    );
    return NEW;
  end if;

  -- 👔 المدير aud → mgt
  if v_old = 'aud' and v_new = 'mgt' then
    perform public.athar_notif_emit_role(
      array['manager', 'admin'], NEW.id, 'aud_ref_mgt',
      'إحالة مخالفة لاعتمادكم',
      format(
        'نفيدكم بإحالة المخالفة رقم (%s) لاعتمادكم النهائي بعد استكمال إجراءات التدقيق، للموظف: %s. نوع المخالفة: %s. يُرجى الاطلاع واتخاذ القرار المناسب.',
        v_ticket, v_emp, v_vtype
      ),
      'red', 'fa-bell', false
    );
    return NEW;
  end if;

  -- 💼 الموارد البشرية mgt → hr
  if v_old = 'mgt' and v_new = 'hr' then
    perform public.athar_notif_emit_role(
      array['hr', 'admin'], NEW.id, 'mgt_ref_hr',
      'استكمال إجراءات مخالفة معتمدة',
      format(
        'نفيدكم باعتماد المدير للمخالفة رقم (%s) الصادرة بحق الموظف: %s. نوع المخالفة: %s. يُرجى الاطلاع وقيد الإجراء في السجل الوظيفي للموظف واستكمال الإجراءات.',
        v_ticket, v_emp, v_vtype
      ),
      'orange', 'fa-bell', false
    );
    return NEW;
  end if;

  -- 🛑 قرارات الإدارة — تنبيه
  if (v_new = 'Warning_Issued' and v_old = 'mgt') or (v_new = 'closed' and v_old = 'mgt' and v_is_warn) then
    if NEW.employee_id is not null then
      perform public.athar_notif_emit(
        NEW.employee_id, 'mgt_warn_emp', NEW.id,
        'اعتماد إجراء - تنبيه بمخالفة',
        format(
          'نفيدكم باعتماد الإدارة إجراء (تنبيه فقط) بشأن المخالفة رقم (%s) من نوع: %s. يُرجى الالتزام بالأنظمة لتفادي تكرار المخالفة.',
          v_ticket, v_vtype
        ),
        'amber', 'fa-hand', 'mine', false
      );
    end if;
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'mgt_warn_sup',
      'اعتماد إجراء مخالفة ضمن منطقتكم',
      format(
        'نفيدكم باعتماد الإدارة إجراء (تنبيه فقط) للمخالفة رقم (%s) للموظف: %s ضمن نطاق إشرافكم. نوع المخالفة: %s.',
        v_ticket, v_emp, v_vtype
      ),
      'amber', 'fa-hand', false
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'mgt_warn_bm',
      'اعتماد إجراء مخالفة تحت إدارتكم',
      format(
        'نفيدكم باعتماد الإدارة إجراء (تنبيه فقط) للمخالفة رقم (%s) للموظف: %s التابع لإدارتكم. نوع المخالفة: %s.',
        v_ticket, v_emp, v_vtype
      ),
      'amber', 'fa-hand', false
    );
    return NEW;
  end if;

  -- قرار الإدارة — إلغاء
  if v_new = 'closed' and v_old = 'mgt' and v_is_cancelled then
    if NEW.employee_id is not null then
      perform public.athar_notif_emit(
        NEW.employee_id, 'mgt_cancel_emp', NEW.id,
        'إلغاء مخالفة مسجلة بحقكم',
        format(
          'نفيدكم بصدور قرار الإدارة بإلغاء المخالفة رقم (%s) من نوع: %s، وتم حفظها بالنظام دون تقييد أي إجراء بحقكم.',
          v_ticket, v_vtype
        ),
        'green', 'fa-circle-check', 'mine', false
      );
    end if;
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'mgt_cancel_sup',
      'إلغاء مخالفة ضمن منطقتكم',
      format(
        'نفيدكم بصدور قرار الإدارة بإلغاء المخالفة رقم (%s) للموظف: %s ضمن نطاق إشرافكم. نوع المخالفة: %s.',
        v_ticket, v_emp, v_vtype
      ),
      'green', 'fa-circle-check', false
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'mgt_cancel_bm',
      'إلغاء مخالفة تحت إدارتكم',
      format(
        'نفيدكم بصدور قرار الإدارة بإلغاء المخالفة رقم (%s) للموظف: %s التابع لإدارتكم. نوع المخالفة: %s.',
        v_ticket, v_emp, v_vtype
      ),
      'green', 'fa-circle-check', false
    );
    return NEW;
  end if;

  -- قرار الإدارة — اعتماد نهائي
  if v_new = 'closed' and v_old = 'mgt' and v_is_approved then
    if NEW.employee_id is not null then
      perform public.athar_notif_emit(
        NEW.employee_id, 'mgt_appr_emp', NEW.id,
        'الإدارة - الاعتماد النهائي للمخالفة',
        format(
          'نفيدكم بالاعتماد النهائي للمخالفة رقم (%s) من قِبل الإدارة، ونوعها: %s، وتم قيد الإجراء الرسمي بحقكم.',
          v_ticket, v_vtype
        ),
        'red', 'fa-triangle-exclamation', 'mine', false
      );
    end if;
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'mgt_appr_sup',
      'الإدارة - الاعتماد النهائي لمخالفة ضمن منطقتكم',
      format(
        'نفيدكم بالاعتماد النهائي من قِبل الإدارة للمخالفة رقم (%s) الصادرة بحق الموظف: %s ضمن نطاق إشرافكم.',
        v_ticket, v_emp
      ),
      'red', 'fa-triangle-exclamation', false
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'mgt_appr_bm',
      'الإدارة - الاعتماد النهائي لمخالفة تحت إدارتكم',
      format(
        'نفيدكم بالاعتماد النهائي من قِبل الإدارة للمخالفة رقم (%s) الصادرة بحق الموظف: %s التابع لإدارتكم.',
        v_ticket, v_emp
      ),
      'red', 'fa-triangle-exclamation', false
    );
    return NEW;
  end if;

  -- 🏢 قرارات الموارد البشرية — تنبيه رسمي
  if (v_new = 'Warning_Issued' and v_old = 'hr') or (v_new = 'closed' and v_old = 'hr' and v_is_warn) then
    if NEW.employee_id is not null then
      perform public.athar_notif_emit(
        NEW.employee_id, 'hr_warn_emp', NEW.id,
        'الموارد البشرية - صدور تنبيه بمخالفة',
        format(
          'نفيدكم بصدور قرار إدارة الموارد البشرية بـ (تنبيه رسمي) بشأن المخالفة رقم (%s) من نوع: %s. يُرجى الالتزام بالأنظمة لتفادي تكرار المخالفة.',
          v_ticket, v_vtype
        ),
        'amber', 'fa-hand', 'mine', false
      );
    end if;
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'hr_warn_sup',
      'الموارد البشرية - إجراء تنبيه لمخالفة ضمن منطقتكم',
      format(
        'نفيدكم بصدور قرار إدارة الموارد البشرية بـ (تنبيه رسمي) للمخالفة رقم (%s) الصادرة بحق الموظف: %s ضمن نطاق إشرافكم.',
        v_ticket, v_emp
      ),
      'amber', 'fa-hand', false
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'hr_warn_bm',
      'الموارد البشرية - إجراء تنبيه لمخالفة تحت إدارتكم',
      format(
        'نفيدكم بصدور قرار إدارة الموارد البشرية بـ (تنبيه رسمي) للمخالفة رقم (%s) الصادرة بحق الموظف: %s التابع لإدارتكم.',
        v_ticket, v_emp
      ),
      'amber', 'fa-hand', false
    );
    return NEW;
  end if;

  -- HR — اعتماد نهائي
  if v_new = 'closed' and v_old = 'hr' and v_is_approved then
    if NEW.employee_id is not null then
      perform public.athar_notif_emit(
        NEW.employee_id, 'hr_appr_emp', NEW.id,
        'الموارد البشرية - الاعتماد النهائي للمخالفة',
        format(
          'نفيدكم بالاعتماد النهائي للمخالفة رقم (%s) من قِبل إدارة الموارد البشرية، ونوعها: %s، وتم قيد الإجراء الرسمي بحقكم في السجل الوظيفي.',
          v_ticket, v_vtype
        ),
        'red', 'fa-triangle-exclamation', 'mine', false
      );
    end if;
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'hr_appr_sup',
      'الموارد البشرية - الاعتماد النهائي لمخالفة ضمن منطقتكم',
      format(
        'نفيدكم بالاعتماد النهائي من قِبل إدارة الموارد البشرية للمخالفة رقم (%s) الصادرة بحق الموظف: %s ضمن نطاق إشرافكم.',
        v_ticket, v_emp
      ),
      'red', 'fa-triangle-exclamation', false
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'hr_appr_bm',
      'الموارد البشرية - الاعتماد النهائي لمخالفة تحت إدارتكم',
      format(
        'نفيدكم بالاعتماد النهائي من قِبل إدارة الموارد البشرية للمخالفة رقم (%s) الصادرة بحق الموظف: %s التابع لإدارتكم.',
        v_ticket, v_emp
      ),
      'red', 'fa-triangle-exclamation', false
    );
    return NEW;
  end if;

  -- HR — إلغاء
  if v_new = 'closed' and v_old = 'hr' and v_is_cancelled then
    if NEW.employee_id is not null then
      perform public.athar_notif_emit(
        NEW.employee_id, 'hr_cancel_emp', NEW.id,
        'الموارد البشرية - إلغاء مخالفة بحقكم',
        format(
          'نفيدكم بصدور قرار إدارة الموارد البشرية بـ (إلغاء) المخالفة المرجعية رقم (%s) من نوع: %s، وتم حفظها بالنظام دون تقييد أي إجراء بحقكم.',
          v_ticket, v_vtype
        ),
        'green', 'fa-circle-check', 'mine', false
      );
    end if;
    perform public.athar_notif_emit_supervisor(
      NEW.branch_id, NEW.id, NEW.employee_id, 'hr_cancel_sup',
      'الموارد البشرية - إلغاء مخالفة ضمن منطقتكم',
      format(
        'نفيدكم بصدور قرار إدارة الموارد البشرية بـ (إلغاء) المخالفة رقم (%s) الصادرة بحق الموظف: %s ضمن نطاق إشرافكم، وحفظها بالنظام.',
        v_ticket, v_emp
      ),
      'green', 'fa-circle-check', false
    );
    perform public.athar_notif_emit_branch_managers(
      NEW.branch_id, NEW.id, NEW.employee_id, 'hr_cancel_bm',
      'الموارد البشرية - إلغاء مخالفة تحت إدارتكم',
      format(
        'نفيدكم بصدور قرار إدارة الموارد البشرية بـ (إلغاء) المخالفة رقم (%s) الصادرة بحق الموظف: %s التابع لإدارتكم، وحفظها بالنظام.',
        v_ticket, v_emp
      ),
      'green', 'fa-circle-check', false
    );
    return NEW;
  end if;

  return NEW;
end;
$$;

drop trigger if exists athar_violation_notify_insert on public.violations;
create trigger athar_violation_notify_insert
  after insert on public.violations
  for each row
  execute function public.athar_notify_violation_insert();

drop trigger if exists athar_violation_notify_state on public.violations;
create trigger athar_violation_notify_state
  after update of state, status_text on public.violations
  for each row
  execute function public.athar_notify_violation_state_change();

-- ─── حذف إشعارات المخالفات بعد 24 ساعة ───
create or replace function public.athar_purge_old_violation_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  with doomed as (
    select id
    from public.notifications
    where ticket_id is not null
      and broadcast_id is null
      and created_at < now() - interval '24 hours'
  ),
  removed as (
    delete from public.notifications n
    using doomed d
    where n.id = d.id
    returning n.id
  )
  select count(*)::integer into v_deleted from removed;
  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.athar_purge_old_violation_notifications() from public;
grant execute on function public.athar_purge_old_violation_notifications() to postgres, service_role;

-- جدولة كل ساعة
select cron.unschedule(j.jobid)
from cron.job j
where j.jobname = 'athar-purge-violation-notifs';

select cron.schedule(
  'athar-purge-violation-notifs',
  '15 * * * *',
  $$select public.athar_purge_old_violation_notifications();$$
);

-- تنظيف فوري للإشعارات الأقدم من 24 ساعة
select public.athar_purge_old_violation_notifications() as purged_now;
