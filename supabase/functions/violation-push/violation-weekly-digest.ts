import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const SENDER_EMAIL_RAW = Deno.env.get('SENDER_EMAIL') ?? 'no-reply@athar-app.online';
const FULL_SENDER = SENDER_EMAIL_RAW.includes('<')
  ? SENDER_EMAIL_RAW
  : `ATHAR <${SENDER_EMAIL_RAW}>`;

/** التقرير الأسبوعي يُرسل فقط لهذه الأدوار — لا موظف/مشرف/مدير فرع/راصد/أدمن */
const DIGEST_ROLES = ['auditor', 'manager', 'hr'] as const;
type DigestRole = (typeof DIGEST_ROLES)[number];

const STATE_TO_ROLE: Record<string, DigestRole> = {
  aud: 'auditor',
  mgt: 'manager',
  hr: 'hr',
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unsubscribeLink(email: string): string {
  const origin = (Deno.env.get('ATHAR_PUBLIC_ORIGIN') || 'https://vms-v2.aromaticfamilies.com').replace(/\/$/, '');
  return `${origin}/?unsubscribe=${encodeURIComponent(email)}`;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const deliveryRef = crypto.randomUUID();
  const unsubscribeUrl = unsubscribeLink(to);
  const host = (Deno.env.get('SES_SMTP_HOST') || '').trim();
  const user = (Deno.env.get('SES_SMTP_USERNAME') || '').trim();
  const pass = (Deno.env.get('SES_SMTP_PASSWORD') || '').trim();
  const port = Number(Deno.env.get('SES_SMTP_PORT') || 587);
  if (!host || !user || !pass) throw new Error('SES SMTP is not configured');

  const nodemailer = await import('npm:nodemailer@6.9.16');
  const transporter = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: FULL_SENDER,
    to,
    subject,
    html,
    text,
    headers: {
      'X-Entity-Ref-ID': deliveryRef,
      'X-ATHAR-Delivery': deliveryRef,
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

export async function runWeeklyDigest(supabase: ReturnType<typeof createClient>) {
  // مخالفات بانتظار التدقيق / الإدارة / الموارد البشرية فقط
  const { data: violations, error } = await supabase
    .from('violations')
    .select(`
      id,
      ticket_number,
      violation_type,
      created_at,
      state,
      employee:employee_id(name),
      branch:branch_id(name)
    `)
    .in('state', Object.keys(STATE_TO_ROLE));

  if (error) throw error;
  if (!violations || violations.length === 0) {
    return { sent: 0, reason: 'no_pending_violations', recipient_roles: [...DIGEST_ROLES] };
  }

  // جلب المستلمين مرة واحدة — مدقق + مدير + موارد بشرية فقط
  const { data: recipients, error: usersErr } = await supabase
    .from('users')
    .select('email, role')
    .in('role', [...DIGEST_ROLES])
    .eq('is_active', true);

  if (usersErr) throw usersErr;

  const emailsByRole = new Map<DigestRole, string[]>();
  for (const role of DIGEST_ROLES) emailsByRole.set(role, []);
  for (const u of recipients || []) {
    const role = String(u.role || '') as DigestRole;
    const email = String(u.email || '').trim().toLowerCase();
    if (!DIGEST_ROLES.includes(role) || !email || !email.includes('@')) continue;
    const list = emailsByRole.get(role)!;
    if (!list.includes(email)) list.push(email);
  }

  const digestMap = new Map<string, typeof violations>(); // email -> violations[]

  for (const v of violations) {
    const role = STATE_TO_ROLE[String(v.state || '')];
    if (!role) continue;
    const emails = emailsByRole.get(role) || [];
    for (const email of emails) {
      if (!digestMap.has(email)) digestMap.set(email, []);
      digestMap.get(email)!.push(v);
    }
  }

  let sentCount = 0;
  const failures: string[] = [];
  for (const [email, userViolations] of digestMap.entries()) {
    const subject = `ملخص المخالفات المعلقة بانتظارك - ATHAR`;
    const unsubscribeUrl = unsubscribeLink(email);

    const tableRows = userViolations.map((v) => {
      const rawTicket = String(v.ticket_number || v.id);
      const formattedTicket = rawTicket.includes('-') ? rawTicket.split('-').pop() : rawTicket;
      const empName = (v as { employee?: { name?: string } }).employee?.name || '—';
      return `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${esc(formattedTicket)}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${esc(empName)}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${esc(v.violation_type || '—')}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${esc(new Date(v.created_at).toLocaleDateString('ar-SA'))}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <div dir="rtl" style="font-family: sans-serif; line-height: 1.6; color: #333;">
        <h2>مرحباً،</h2>
        <p>لديك <strong>${userViolations.length}</strong> مخالفات معلقة بانتظار اتخاذ إجراء منك:</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f8f9fa;">
              <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">رقم المخالفة</th>
              <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">اسم الموظف</th>
              <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">نوع المخالفة</th>
              <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">تاريخ الرصد</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <p style="margin-top: 20px;">يرجى مراجعة التفاصيل عبر تطبيق أثر</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="font-size: 11px; color: #999; text-align: center;">
          رسالة تلقائية من منصة أثر يرجى عدم الرد على هذا البريد.
          <br>
          <a href="${unsubscribeUrl}" style="color: #999; text-decoration: underline;">إلغاء الاشتراك من هذه التنبيهات</a>
        </p>
      </div>
    `;

    const text = `ملخص المخالفات المعلقة بانتظارك: ${userViolations.length} مخالفات. يرجى الدخول للتطبيق.`;

    try {
      await sendEmail(email, subject, html, text);
      sentCount++;
    } catch (err) {
      console.error(`Failed to send digest to ${email}:`, err);
      failures.push(`${email}: ${String(err)}`);
    }
  }

  return {
    sent: sentCount,
    total_violations: violations.length,
    recipient_roles: [...DIGEST_ROLES],
    recipient_emails: digestMap.size,
    failures: failures.length ? failures : undefined,
  };
}
