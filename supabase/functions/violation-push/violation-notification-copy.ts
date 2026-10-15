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
  sendEmail?: boolean;
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
      title: 'تم تسجيل مخالفة',
      message:
        `تم تسجيل مخالفة برقم مرجعي (${ticket}) نوع المخالفة: ${vType} نأمل تقديم إفادتكم عبر التطبيق خلال 24 ساعة علماً بأنه سيتم تمرير المخالفة تلقائياً في حال عدم الرد`,
      eventKeySuffix: 'vnew_emp',
      scope: 'mine',
      type: 'amber',
      icon: 'fa-bell',
      sendEmail: true,
    },
    {
      recipientRole: 'supervisor',
      title: 'رصد مخالفة ضمن منطقتكم',
      message:
        `نفيدكم برصد مخالفة برقم (${ticket}) على الموظف: ${emp}، ضمن نطاق إشرافكم. نوع المخالفة: ${vType}. للإحاطة ومتابعة اسيرها.`,
      eventKeySuffix: 'vnew_sup',
      scope: 'team',
      type: 'blue',
      icon: 'fa-bell',
    },
    {
      recipientRole: 'branch_manager',
      title: 'تسجيل مخالفة على أحد منسوبي الفرع',
      message:
        `تم تسجيل مخالفة برقم (${ticket}) على الموظف: ${emp} نوع المخالفة: ${vType} يُرجى الاطلاع ومتابعة الإجراءات عبر التطبيق`,
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
          `نفيدكم بأن الموظف: ${emp} قام بتقديم الإفادة على المخالفة رقم (${ticket}) من نوع: ${vType} يرجى الاطلاع وتقديم الافادة`,
        eventKeySuffix: 'emp_resp_sup',
        scope: 'team',
        type: 'blue',
        icon: 'fa-reply',
        sendEmail: true,
      },
      {
        recipientRole: 'branch_manager',
        title: 'استلام إفادة مخالفة',
        message:
          `للاطلاع: تم استلام إفادة الموظف ${emp} بشأن المخالفة رقم (${ticket}) - ${vType}`,
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
          `نفيدكم بتمرير المخالفة رقم (${ticket}) تلقائياً لعدم الرد خلال المهلة المحددة، على الموظف: ${emp} ضمن نطاق إشرافكم.`,
        eventKeySuffix: 'auto_emp_sup',
        scope: 'team',
        type: 'amber',
        icon: 'fa-robot',
        isAuto: true,
        sendEmail: true,
      },
      {
        recipientRole: 'branch_manager',
        title: 'تمرير تلقائي لمخالفة',
        message:
          `للاطلاع: تم تمرير المخالفة رقم (${ticket}) الخاصة بالموظف: ${emp} تلقائياً لعدم تقديم الإفادة خلال المهلة المحددة`,
        eventKeySuffix: 'auto_emp_bm',
        scope: 'team',
        type: 'amber',
        icon: 'fa-robot',
        isAuto: true,
      },
    );
    return out;
  }

  // 👔 رابعاً: الإدارة — رد المشرف أو تمرير تلقائي sup → mgt
  if (prev === 'sup' && state === 'mgt' && !autoSup) {
    out.push({
      recipientRole: 'manager',
      title: 'إحالة مخالفة للإدارة',
      message:
        `نفيدكم بإحالة المخالفة رقم (${ticket}) لمراجعتكم بعد استكمال إجراءات المشرف، للموظف: ${emp}. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'sup_ref_mgt',
      scope: 'mine',
      type: 'red',
      icon: 'fa-bell',
    });
    return out;
  }

  if (prev === 'sup' && state === 'mgt' && autoSup) {
    out.push({
      recipientRole: 'manager',
      title: 'تم تمرير مخالفة تلقائياً للإدارة',
      message:
        `نفيدكم بتمرير المخالفة رقم (${ticket}) تلقائياً لمراجعتكم لعدم اتخاذ إجراء من قِبل المشرف خلال المهلة، للموظف: ${emp}.`,
      eventKeySuffix: 'auto_sup_mgt',
      scope: 'mine',
      type: 'red',
      icon: 'fa-robot',
      isAuto: true,
    });
    return out;
  }

  // توافق تذاكر قديمة: مشرف → رقابة داخلية مباشرة
  if (prev === 'sup' && state === 'aud' && !autoSup) {
    out.push({
      recipientRole: 'auditor',
      title: 'إحالة مخالفة للرقابة الداخلية',
      message:
        `نفيدكم بإحالة المخالفة رقم (${ticket}) لمراجعة الرقابة الداخلية بعد استكمال إجراءات المشرف، للموظف: ${emp}. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'sup_ref_aud',
      scope: 'mine',
      type: 'purple',
      icon: 'fa-bell',
    });
    return out;
  }

  if (prev === 'sup' && state === 'aud' && autoSup) {
    out.push({
      recipientRole: 'auditor',
      title: 'تم تمرير مخالفة تلقائياً للرقابة الداخلية',
      message:
        `نفيدكم بتمرير المخالفة رقم (${ticket}) تلقائياً للرقابة الداخلية لعدم اتخاذ إجراء من قِبل المشرف خلال المهلة، للموظف: ${emp}.`,
      eventKeySuffix: 'auto_sup_aud',
      scope: 'mine',
      type: 'purple',
      icon: 'fa-robot',
      isAuto: true,
    });
    return out;
  }

  // 🔍 خامساً: الرقابة الداخلية — بعد الإدارة mgt → aud
  if (prev === 'mgt' && state === 'aud') {
    out.push({
      recipientRole: 'auditor',
      title: 'إحالة مخالفة للرقابة الداخلية',
      message:
        `نفيدكم بإحالة المخالفة رقم (${ticket}) لمراجعة إدارة الرقابة الداخلية بعد استكمال إجراءات الإدارة، للموظف: ${emp}. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'mgt_ref_aud',
      scope: 'mine',
      type: 'purple',
      icon: 'fa-bell',
    });
    return out;
  }

  // توافق قديم: رقابة → إدارة
  if (prev === 'aud' && state === 'mgt') {
    out.push({
      recipientRole: 'manager',
      title: 'إحالة مخالفة لاعتمادكم',
      message:
        `نفيدكم بإحالة المخالفة رقم (${ticket}) لاعتمادكم بعد استكمال إجراءات الرقابة الداخلية، للموظف: ${emp}. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'aud_ref_mgt',
      scope: 'mine',
      type: 'red',
      icon: 'fa-bell',
    });
    return out;
  }

  // 💼 الموارد البشرية mgt → hr أو aud → hr
  if ((prev === 'mgt' || prev === 'aud') && state === 'hr') {
    out.push({
      recipientRole: 'hr',
      title: 'استكمال إجراءات مخالفة معتمدة',
      message:
        `نفيدكم باعتماد المخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp}. نوع المخالفة: ${vType}. يُرجى الاطلاع وقيد الإجراء.`,
      eventKeySuffix: prev === 'aud' ? 'aud_ref_hr' : 'mgt_ref_hr',
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

  // قرار الإدارة — اعتماد نهائي (بدون إحالة لاحقة)
  if (state === 'closed' && prev === 'mgt' && isApproved) {
    out.push(...managerApproveTemplates(ticket, emp, vType));
    return out;
  }

  // قرارات الرقابة الداخلية — إلغاء / اعتماد نهائي
  if (state === 'closed' && prev === 'aud' && isCancelled) {
    out.push(...auditorCancelTemplates(ticket, emp, vType));
    return out;
  }
  if (state === 'closed' && prev === 'aud' && isApproved) {
    out.push(...auditorApproveTemplates(ticket, emp, vType));
    return out;
  }

  // 🏢 قرارات الموارد البشرية — تنبيه رسمي
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
      title: 'قرار إداري – تنبيه بمخالفة',
      message:
        `تم إصدار تنبيه أول بشأن المخالفة رقم (${ticket}) - ${vType} نأمل منكم الالتزام بالأنظمة والتعليمات المعتمدة تفادياً لتصعيد الإجراء`,
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
      title: 'قرار إداري – تنبيه على مخالفة',
      message:
        `أصدرت إدارة المبيعات تنبيه أول بشأن المخالفة رقم (${ticket}) للموظف: ${emp} - ${vType}`,
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
      title: 'قرار إداري – إلغاء مخالفة',
      message:
        `تم إصدار قرار بإلغاء المخالفة رقم (${ticket}) - ${vType} وحفظها في التطبيق دون اتخاذ أي إجراء`,
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
      title: 'قرار إداري – إلغاء مخالفة',
      message:
        `أصدرت إدارة المبيعات قراراً بإلغاء المخالفة رقم (${ticket}) للموظف: ${emp} - ${vType} وتم حفظها في النظام`,
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
      title: 'قرار إداري – اعتماد نهائي لمخالفة',
      message:
        `تم الاعتماد النهائي للمخالفة رقم (${ticket}) - ${vType} من قِبل الإدارة وتم قيد الإجراء في سجلكم`,
      eventKeySuffix: 'mgt_appr_emp',
      scope: 'mine',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'supervisor',
      title: 'الإدارة - الاعتماد النهائي لمخالفة ضمن منطقتكم',
      message:
        `نفيدكم بالاعتماد النهائي من قِبل الإدارة للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'mgt_appr_sup',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'branch_manager',
      title: 'قرار إداري – اعتماد نهائي لمخالفة',
      message:
        `أصدرت إدارة المبيعات قراراً بالاعتماد النهائي للمخالفة رقم (${ticket}) بحق الموظف: ${emp}`,
      eventKeySuffix: 'mgt_appr_bm',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
  ];
}

function auditorApproveTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'قرار الرقابة الداخلية – اعتماد نهائي لمخالفة',
      message:
        `تم الاعتماد النهائي للمخالفة رقم (${ticket}) - ${vType} من قِبل إدارة الرقابة الداخلية وتم قيد الإجراء في سجلكم`,
      eventKeySuffix: 'aud_appr_emp',
      scope: 'mine',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'supervisor',
      title: 'الرقابة الداخلية - الاعتماد النهائي لمخالفة ضمن منطقتكم',
      message:
        `نفيدكم بالاعتماد النهائي من قِبل إدارة الرقابة الداخلية للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'aud_appr_sup',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'branch_manager',
      title: 'قرار الرقابة الداخلية – اعتماد نهائي لمخالفة',
      message:
        `أصدرت إدارة الرقابة الداخلية قراراً بالاعتماد النهائي للمخالفة رقم (${ticket}) بحق الموظف: ${emp}`,
      eventKeySuffix: 'aud_appr_bm',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
  ];
}

function auditorCancelTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'قرار الرقابة الداخلية – إلغاء مخالفة',
      message:
        `تم إصدار قرار بإلغاء المخالفة رقم (${ticket}) - ${vType} من قِبل إدارة الرقابة الداخلية وحفظها في التطبيق دون اتخاذ أي إجراء`,
      eventKeySuffix: 'aud_cancel_emp',
      scope: 'mine',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'supervisor',
      title: 'إلغاء مخالفة ضمن منطقتكم من الرقابة الداخلية',
      message:
        `نفيدكم بصدور قرار إدارة الرقابة الداخلية بإلغاء المخالفة رقم (${ticket}) للموظف: ${emp} ضمن نطاق إشرافكم. نوع المخالفة: ${vType}.`,
      eventKeySuffix: 'aud_cancel_sup',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'branch_manager',
      title: 'قرار الرقابة الداخلية – إلغاء مخالفة',
      message:
        `أصدرت إدارة الرقابة الداخلية قراراً بإلغاء المخالفة رقم (${ticket}) للموظف: ${emp} - ${vType} وتم حفظها في النظام`,
      eventKeySuffix: 'aud_cancel_bm',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
  ];
}

function hrWarningTemplates(ticket: string, emp: string, vType: string): ViolationNotifTemplate[] {
  return [
    {
      recipientRole: 'employee',
      title: 'قرار الموارد البشرية – تنبيه مخالفات',
      message:
        `تم إصدار تنبيه أول من إدارة الموارد البشرية بشأن المخالفة رقم (${ticket}) - ${vType} نأمل الالتزام بالأنظمة المعتمدة`,
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
      title: 'قرار الموارد البشرية – تنبيه مخالفة',
      message:
        `أصدرت إدارة الموارد البشرية تنبيه أول بشأن المخالفة رقم (${ticket}) للموظف: ${emp}`,
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
      title: 'قرار الموارد البشرية – اعتماد نهائي لمخالفة',
      message:
        `تم الاعتماد النهائي للمخالفة رقم (${ticket}) - ${vType} من قِبل إدارة الموارد البشرية وتم قيد الإجراء`,
      eventKeySuffix: 'hr_appr_emp',
      scope: 'mine',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'supervisor',
      title: 'الموارد البشرية - الاعتماد النهائي لمخالفة ضمن منط��تكم',
      message:
        `نفيدكم بالاعتماد النهائي من قِبل إدارة الموارد البشرية للمخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم.`,
      eventKeySuffix: 'hr_appr_sup',
      scope: 'team',
      type: 'red',
      icon: 'fa-triangle-exclamation',
    },
    {
      recipientRole: 'branch_manager',
      title: 'قرار الموارد البشرية – اعتماد نهائي',
      message:
        `تم الاعتماد النهائي للمخالفة رقم (${ticket}) من قِبل إدارة الموارد البشرية بحق الموظف: ${emp}`,
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
      title: 'قرار الموارد البشرية – إلغاء مخالفة',
      message:
        `تم إصدار قرار من إدارة الموارد البشرية بإلغاء المخالفة رقم (${ticket}) - ${vType} وحفظها في النظام`,
      eventKeySuffix: 'hr_cancel_emp',
      scope: 'mine',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'supervisor',
      title: 'الموارد البشرية - إلغاء مخالفة ضمن منطقتكم',
      message:
        `نفيدكم بصدور قرار إدارة الموارد البشرية بـ (إلغاء) المخالفة رقم (${ticket}) الصادرة بحق الموظف: ${emp} ضمن نطاق إشرافكم.`,
      eventKeySuffix: 'hr_cancel_sup',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
    {
      recipientRole: 'branch_manager',
      title: 'قرار الموارد البشرية – إلغاء مخالفة',
      message:
        `أصدرت إدارة الموارد البشرية قراراً بإلغاء المخالفة رقم (${ticket}) للموظف: ${emp} وتم حفظها في النظام`,
      eventKeySuffix: 'hr_cancel_bm',
      scope: 'team',
      type: 'green',
      icon: 'fa-circle-check',
    },
  ];
}
