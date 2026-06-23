/** نصوص إشعارات المخالفات — الخطة الرسمية 2026 */

export type RecipientRole =
  | 'employee'
  | 'supervisor'
  | 'branch_manager'
  | 'auditor'
  | 'manager'
  | 'hr';

export interface ViolationNotifTemplate {
  recipientRole: RecipientRole;
  title: string;
  message: string;
  eventKeySuffix: string;
  scope: 'mine' | 'team';
  type: string;
  icon: string;
  isAuto?: boolean;
}

export interface ViolationNotifContext {
  id: string;
  ticket_number?: string | number | null;
  violation_type?: string | null;
  employee_id?: string | null;
  branch_id?: string | null;
  state?: string | null;
  status_text?: string | null;
  auto_forwarded_emp?: boolean | null;
  auto_forwarded_sup?: boolean | null;
}

export function shortTicketNum(n: unknown): string {
  if (n == null || n === '') return '—';
  const parts = String(n).trim().split('-');
  return parts.length >= 3 ? parts[parts.length - 1] : String(n).trim();
}

export function isDbTruthy(val: unknown): boolean {
  return val === true || val === 1 || val === 'true' || val === 't';
}

function ctxVars(ctx: ViolationNotifContext, employeeName: string) {
  return {
    ticket: shortTicketNum(ctx.ticket_number),
    vType: String(ctx.violation_type || '—').trim() || '—',
    emp: String(employeeName || '').trim() || 'الموظف',
  };
}

function statusFlags(statusText: string | null | undefined) {
  const st = String(statusText || '');
  const isWarn = /تنبيه|اكتفاء بالتنبيه|Warning_Issued/i.test(st);
  const isCancelled = /ملغ|مرفوض/i.test(st);
  const isApproved = /معتمد/i.test(st) && !isWarn;
  return { isWarn, isCancelled, isApproved };
}

/** 🛑 أولاً: رصد مخالفة جديدة */
export function buildNewViolationTemplates(
  ctx: ViolationNotifContext,
  employeeName: string,
): ViolationNotifTemplate[] {
  const { ticket, vType, emp } = ctxVars(ctx, employeeName);
  return [
    {
      recipientRole: 'employee',
      title: 'تم تسجيل مخالفة بحقك',
      message:
        `نفيدكم بتسجيل مخالفة بحقكم برقم مرجعي (${ticket}). نوع المخالفة: ${vType}. يُرجى تقديم الإفادة عبر النظام خلال 24 ساعة؛ تجنباً للتمرير التلقائي.`,
      eventKeySuffix: 'vnew_emp',
      scope: 'mine',
      type: 'amber',
      icon: 'fa-bell',
    },
    {
      recipientRole: 'supervisor',
      title: 'رصد مخالفة ضمن منطقتكم',
      message:
        `نفيدكم برصد مخالفة برقم (${ticket}) على الموظف: ${emp}، ضمن نطاق إشرافكم. نوع المخالفة: ${vType}. للإحاطة ومتابعة استكمال الإجراءات.`,
      eventKeySuffix: 'vnew_sup',
      scope: 'team',
      type: 'blue',
      icon: 'fa-bell',
    },
    {
      recipientRole: 'branch_manager',
      title: 'رصد مخالفة تحت إدارتكم',
      message:
        `نفيدكم بقيد مخالفة برقم (${ticket}) على الموظف: ${emp}، التابع لإدارتكم. نوع المخالفة: ${vType}. للاطلاع ومتابعة سير الإجراء.`,
      eventKeySuffix: 'vnew_bm',
      scope: 'team',
      type: 'amber',
      icon: 'fa-clipboard-list',
    },
  ];
}

/** بناء إشعارات تغيّر المرحلة / القرار النهائي */
export function buildStateChangeTemplates(
  ctx: ViolationNotifContext,
  previousState: string | null | undefined,
  employeeName: string,
): ViolationNotifTemplate[] {
  const state = String(ctx.state || '').trim();
  const prev = previousState != null ? String(previousState).trim() : '';
  const { ticket, vType, emp } = ctxVars(ctx, employeeName);
  const autoEmp = isDbTruthy(ctx.auto_forwarded_emp);
  const autoSup = isDbTruthy(ctx.auto_forwarded_sup);
  const { isWarn, isCancelled, isApproved } = statusFlags(ctx.status_text);

  const out: ViolationNotifTemplate[] = [];

  // ✉️ ثانياً: رد الموظف emp → sup (بدون تمرير تلقائي)
  if (prev === 'emp' && state === 'sup' && !autoEmp) {
    out.push(
      {
        recipientRole: 'supervisor',
        title: 'تم تقديم الإفادة على مخالفة ضمن منطقتكم',
        message:
          `نفيدكم بأن الموظف: ${emp} قام بتقديم الإفادة على المخالفة رقم (${ticket}) من نوع: ${vType}. يُرجى الاطلاع ومتابعة استكمال الإجراءات.`,
        eventKeySuffix: 'emp_resp_sup',
        scope: 'team',
        type: 'blue',
        icon: 'fa-reply',
      },
      {
        recipientRole: 'branch_manager',
        title: 'تم الرد على مخالفة تحت إدارتكم',
        message:
          `نفيدكم بأن الموظف: ${emp} التابع لإدارتكم، قد قام بتقديم الإفادة على المخالفة رقم (${ticket}) من نوع: ${vType}. يُرجى الاطلاع ومراجعة الرد.`,
        eventKeySuffix: 'emp_resp_bm',
        scope: 'team',
        type: 'blue',
        icon: 'fa-reply',
      },
    );
    return out;
  }

  // ⏳ ثالثاً: تمرير تلقائي emp → sup
  if (prev === 'emp' && state === 'sup' && autoEmp) {
    out.push(
      {
        recipientRole: 'supervisor',
        title: 'تم تمرير مخالفة تلقائياً ضمن منطقتكم',
        message:
          `نفيدكم بتمرير المخالفة رقم (${ticket}) تلقائياً لعدم الرد خلال المهلة المحددة، على الموظف: ${emp} ضمن نطاق إشرافكم. نوع المخالفة: ${vType}. للإحاطة ومتابعة الإجراء.`,
        eventKeySuffix: 'auto_emp_sup',
        scope: 'team',
        type: 'amber',
        icon: 'fa-robot',
        isAuto: true,
      },
      {
        recipientRole: 'branch_manager',
        title: 'تم تمرير مخالفة تلقائياً تحت إدارتكم',
        message:
          `نفيدكم بتمرير المخالفة رقم (${ticket}) تلقائياً لعدم الرد خلال المهلة المحددة، على الموظف: ${emp} التابع لإدارتكم. نوع المخالفة: ${vType}. للاطلاع ومتابعة سير الإجراء.`,
        eventKeySuffix: 'auto_emp_bm',
        scope: 'team',
        type: 'amber',
        icon: 'fa-robot',
        isAuto: true,
      },
    );
    return out;
  }

  // 🔍 رابعاً: المدقق — رد المشرف sup → aud
  if (prev === 'sup' && state === 'aud' && !autoSup) {
    out.push({
      recipientRole: 'auditor',
      title: 'إحالة مخالفة للتدقيق',
      message:
        `نفيدكم بإحالة المخالفة رقم (${ticket}) لتدقيقكم بعد استكمال إجراءات المشرف، للموظف: ${emp}. نوع المخالفة: ${vType}. يُرجى الاطلاع ومراجعة الإجراء.`,
      eventKeySuffix: 'sup_ref_aud',
      scope: 'mine',
      type: 'purple',
      icon: 'fa-bell',
    });
    return out;
  }

  // تمرير تلقائي sup → aud
  if (prev === 'sup' && state === 'aud' && autoSup) {
    out.push({
      recipientRole: 'auditor',
      title: 'تم تمرير مخالفة تلقائياً لتدقيقكم',
      message:
        `نفيدكم بتمرير المخالفة رقم (${ticket}) تلقائياً لتدقيقكم لعدم اتخاذ إجراء من قِبل المشرف خلال المهلة، للموظف: ${emp}. نوع المخالفة: ${vType}. يُرجى الاطلاع والاعتماد.`,
      eventKeySuffix: 'auto_sup_aud',
      scope: 'mine',
      type: 'purple',
      icon: 'fa-robot',
      isAuto: true,
    });
    return out;
  }

  // 👔 خامساً: المدير aud → mgt
  if (prev === 'aud' && state === 'mgt') {
    out.push({
      recipientRole: 'manager',
      title: 'إحالة مخالفة لاعتمادكم',
      message:
        `نفيدكم بإحالة المخالفة رقم (${ticket}) لاعتمادكم النهائي بعد استكمال إجراءات التدقيق، للموظف: ${emp}. نوع المخالفة: ${vType}. يُرجى الاطلاع واتخاذ القرار المناسب.`,
      eventKeySuffix: 'aud_ref_mgt',
      scope: 'mine',
      type: 'red',
      icon: 'fa-bell',
    });
    return out;
  }

  // 💼 سابعاً: الموارد البشرية mgt → hr
  if (prev === 'mgt' && state === 'hr') {
    out.push({
      recipientRole: 'hr',
      title: 'استكمال إجراءات مخالفة معتمدة',
      message:
        `نفيدكم باعتماد المدير للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp}. نوع المخالفة: ${vType}. يُرجى الاطلاع وقيد الإجراء في السجل الوظيفي للموظف واستكمال الإجراءات.`,
      eventKeySuffix: 'mgt_ref_hr',
      scope: 'mine',
      type: 'orange',
      icon: 'fa-bell',
    });
    return out;
  }

  // 🛑 سادساً: قرارات الإدارة (المدير) — تنبيه فقط
  if ((state === 'Warning_Issued' && prev === 'mgt') || (state === 'closed' && prev === 'mgt' && isWarn)) {
    out.push(...managerWarningTemplates(ticket, emp, vType));
    return out;
  }

  // قرار الإدارة — إلغاء
  if (state === 'closed' && prev === 'mgt' && isCancelled) {
    out.push(...managerCancelTemplates(ticket, emp, vType));
    return out;
  }

  // قرار الإدارة — اعتماد نهائي (بدون إحالة HR)
  if (state === 'closed' && prev === 'mgt' && isApproved) {
    out.push(...managerApproveTemplates(ticket, emp, vType));
    return out;
  }

  // 🏢 ثامناً: قرارات الموارد البشرية — تنبيه رسمي
  if ((state === 'Warning_Issued' && prev === 'hr') || (state === 'closed' && prev === 'hr' && isWarn)) {
    out.push(...hrWarningTemplates(ticket, emp, vType));
    return out;
  }

  // HR — اعتماد نهائي
  if (state === 'closed' && prev === 'hr' && isApproved) {
    out.push(...hrApproveTemplates(ticket, emp, vType));
    return out;
  }

  // HR — إلغاء
  if (state === 'closed' && prev === 'hr' && isCancelled) {
    out.push(...hrCancelTemplates(ticket, emp, vType));
    return out;
  }

  return out;
}

function managerWarningTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'اعتماد إجراء - تنبيه بمخالفة',
      message:
        `نفيدكم باعتماد الإدارة إجراء (تنبيه فقط) بشأن المخالفة رقم (${ticket}) من نوع: ${vType}. يُرجى الالتزام بالأنظمة لتفادي تكرار المخالفة.`,
      eventKeySuffix: 'mgt_warn_emp',
      scope: 'mine',
      type: 'amber',
      icon: 'fa-hand',
    },
    {
      recipientRole: 'supervisor',
      title: 'اعتماد إجراء مخالفة ضمن منطقتكم',
      message:
        `نفيدكم باعتماد الإدارة إجراء (تنبيه فقط) للمخالفة رقم (${ticket}) للموظف: ${emp} ضمن نطاق إشرافكم. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'mgt_warn_sup',
      scope: 'team',
      type: 'amber',
      icon: 'fa-hand',
    },
    {
      recipientRole: 'branch_manager',
      title: 'اعتماد إجراء مخالفة تحت إدارتكم',
      message:
        `نفيدكم باعتماد الإدارة إجراء (تنبيه فقط) للمخالفة رقم (${ticket}) للموظف: ${emp} التابع لإدارتكم. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'mgt_warn_bm',
      scope: 'team',
      type: 'amber',
      icon: 'fa-hand',
    },
  ];
}

function managerCancelTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'إلغاء مخالفة مسجلة بحقكم',
      message:
        `نفيدكم بصدور قرار الإدارة بإلغاء المخالفة رقم (${ticket}) من نوع: ${vType}، وتم حفظها بالنظام دون تقييد أي إجراء بحقكم.`,
      eventKeySuffix: 'mgt_cancel_emp',
      scope: 'mine',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'supervisor',
      title: 'إلغاء مخالفة ضمن منطقتكم',
      message:
        `نفيدكم بصدور قرار الإدارة بإلغاء المخالفة رقم (${ticket}) للموظف: ${emp} ضمن نطاق إشرافكم. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'mgt_cancel_sup',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'branch_manager',
      title: 'إلغاء مخالفة تحت إدارتكم',
      message:
        `نفيدكم بصدور قرار الإدارة بإلغاء المخالفة رقم (${ticket}) للموظف: ${emp} التابع لإدارتكم. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'mgt_cancel_bm',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
  ];
}

function managerApproveTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'الإدارة - الاعتماد النهائي للمخالفة',
      message:
        `نفيدكم بالاعتماد النهائي للمخالفة رقم (${ticket}) من قِبل الإدارة، ونوعها: ${vType}، وتم قيد الإجراء الرسمي بحقكم.`,
      eventKeySuffix: 'mgt_appr_emp',
      scope: 'mine',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'supervisor',
      title: 'الإدارة - الاعتماد النهائي لمخالفة ضمن منطقتكم',
      message:
        `نفيدكم بالاعتماد النهائي من قِبل الإدارة للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم.`,
      eventKeySuffix: 'mgt_appr_sup',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'branch_manager',
      title: 'الإدارة - الاعتماد النهائي لمخالفة تحت إدارتكم',
      message:
        `نفيدكم بالاعتماد النهائي من قِبل الإدارة للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} التابع لإدارتكم.`,
      eventKeySuffix: 'mgt_appr_bm',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
  ];
}

function hrWarningTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'الموارد البشرية - صدور تنبيه بمخالفة',
      message:
        `نفيدكم بصدور قرار إدارة الموارد البشرية بـ (تنبيه رسمي) بشأن المخالفة رقم (${ticket}) من نوع: ${vType}. يُرجى الالتزام بالأنظمة لتفادي تكرار المخالفة.`,
      eventKeySuffix: 'hr_warn_emp',
      scope: 'mine',
      type: 'amber',
      icon: 'fa-hand',
    },
    {
      recipientRole: 'supervisor',
      title: 'الموارد البشرية - إجراء تنبيه لمخالفة ضمن منطقتكم',
      message:
        `نفيدكم بصدور قرار إدارة الموارد البشرية بـ (تنبيه رسمي) للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم.`,
      eventKeySuffix: 'hr_warn_sup',
      scope: 'team',
      type: 'amber',
      icon: 'fa-hand',
    },
    {
      recipientRole: 'branch_manager',
      title: 'الموارد البشرية - إجراء تنبيه لمخالفة تحت إدارتكم',
      message:
        `نفيدكم بصدور قرار إدارة الموارد البشرية بـ (تنبيه رسمي) للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} التابع لإدارتكم.`,
      eventKeySuffix: 'hr_warn_bm',
      scope: 'team',
      type: 'amber',
      icon: 'fa-hand',
    },
  ];
}

function hrApproveTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'الموارد البشرية - الاعتماد النهائي للمخالفة',
      message:
        `نفيدكم بالاعتماد النهائي للمخالفة رقم (${ticket}) من قِبل إدارة الموارد البشرية، ونوعها: ${vType}، وتم قيد الإجراء الرسمي بحقكم في السجل الوظيفي.`,
      eventKeySuffix: 'hr_appr_emp',
      scope: 'mine',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'supervisor',
      title: 'الموارد البشرية - الاعتماد النهائي لمخالفة ضمن منطقتكم',
      message:
        `نفيدكم بالاعتماد النهائي من قِبل إدارة الموارد البشرية للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم.`,
      eventKeySuffix: 'hr_appr_sup',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'branch_manager',
      title: 'الموارد البشرية - الاعتماد النهائي لمخالفة تحت إدارتكم',
      message:
        `نفيدكم بالاعتماد النهائي من قِبل إدارة الموارد البشرية للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} التابع لإدارتكم.`,
      eventKeySuffix: 'hr_appr_bm',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
  ];
}

function hrCancelTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'الموارد البشرية - إلغاء مخالفة بحقكم',
      message:
        `نفيدكم بصدور قرار إدارة الموارد البشرية بـ (إلغاء) المخالفة المرجعية رقم (${ticket}) من نوع: ${vType}، وتم حفظها بالنظام دون تقييد أي إجراء بحقكم.`,
      eventKeySuffix: 'hr_cancel_emp',
      scope: 'mine',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'supervisor',
      title: 'الموارد البشرية - إلغاء مخالفة ضمن منطقتكم',
      message:
        `نفيدكم بصدور قرار إدارة الموارد البشرية بـ (إلغاء) المخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم، وحفظها بالنظام.`,
      eventKeySuffix: 'hr_cancel_sup',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'branch_manager',
      title: 'الموارد البشرية - إلغاء مخالفة تحت إدارتكم',
      message:
        `نفيدكم بصدور قرار إدارة الموارد البشرية بـ (إلغاء) المخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} التابع لإدارتكم، وحفظها بالنظام.`,
      eventKeySuffix: 'hr_cancel_bm',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
  ];
}
