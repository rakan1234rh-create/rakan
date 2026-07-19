import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const SENDER_EMAIL_RAW = Deno.env.get('SENDER_EMAIL') ?? 'no-reply@athar-app.online';
const FULL_SENDER = SENDER_EMAIL_RAW.includes('<')
  ? SENDER_EMAIL_RAW
  : `ATHAR <${SENDER_EMAIL_RAW}>`;

const SENDER_EMAIL = SENDER_EMAIL_RAW.includes('<')
  ? SENDER_EMAIL_RAW.match(/<(.+)>|$/)?.[1] || SENDER_EMAIL_RAW
  : SENDER_EMAIL_RAW;
const SENDER_NAME = SENDER_EMAIL_RAW.includes('<')
  ? SENDER_EMAIL_RAW.split('<')[0].trim()
  : 'ATHAR';

/** التقرير الأسبوعي يُرسل فقط لهذه الأدوار — لا موظف/مشرف/مدير فرع/راصد/أدمن */
const DIGEST_ROLES = ['auditor', 'manager', 'hr'] as const;
type DigestRole = (typeof DIGEST_ROLES)[number];

const STATE_TO_ROLE: Record<string, DigestRole> = {
  aud: 'auditor',
  mgt: 'manager',
  hr: 'hr',
};

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

function isAppleMailbox(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return APPLE_DOMAINS.has(domain);
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unsubscribeLink(email: string): string {
  return `https://athar-app.online/settings?unsubscribe=${encodeURIComponent(email)}`;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const deliveryRef = crypto.randomUUID();
  const unsubscribeUrl = unsubscribeLink(to);
  const antiThreadHeaders = {
    'X-Entity-Ref-ID': deliveryRef,
    'X-ATHAR-Delivery': deliveryRef,
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };

  const isApple = isAppleMailbox(to);
  if (isApple && BREVO_API_KEY) {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Brevo failed: ${err}`);
    }
  } else if (resend) {
    const { error } = await resend.emails.send({
      from: FULL_SENDER,
      to: [to],
      subject,
      html,
      text,
      headers: antiThreadHeaders,
    });
    if (error) throw new Error(`Resend failed: ${error.message}`);
  } else {
    throw new Error('No email provider configured');
  }
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
