import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const SENDER_EMAIL_RAW = Deno.env.get('SENDER_EMAIL') ?? 'no-reply@athar-app.online';
// Check if SENDER_EMAIL already contains a display name like "Name <email@example.com>"
const FULL_SENDER = SENDER_EMAIL_RAW.includes('<') 
  ? SENDER_EMAIL_RAW 
  : `ATHAR <${SENDER_EMAIL_RAW}>`;

// Extract just the email part for providers that need it separately
const SENDER_EMAIL = SENDER_EMAIL_RAW.includes('<')
  ? SENDER_EMAIL_RAW.match(/<(.+)>|$/)?.[1] || SENDER_EMAIL_RAW
  : SENDER_EMAIL_RAW;
const SENDER_NAME = SENDER_EMAIL_RAW.includes('<')
  ? SENDER_EMAIL_RAW.split('<')[0].trim()
  : 'ATHAR';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

function isAppleMailbox(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return APPLE_DOMAINS.has(domain);
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const deliveryRef = crypto.randomUUID();
  const antiThreadHeaders = {
    'X-Entity-Ref-ID': deliveryRef,
    'X-ATHAR-Delivery': deliveryRef,
  };

  if (isAppleMailbox(to) && BREVO_API_KEY) {
    // Send via Brevo
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        headers: antiThreadHeaders,
      }),
    });
    if (!response.ok) throw new Error(`Brevo failed: ${await response.text()}`);
  } else if (resend) {
    // Send via Resend
    const { error } = await resend.emails.send({
      from: FULL_SENDER,
      to: [to],
      subject,
      html,
      text,
      headers: antiThreadHeaders,
    });
    if (error) throw new Error(`Resend failed: ${error.message}`);
  }
}

export async function runWeeklyDigest(supabase: ReturnType<typeof createClient>) {
  // 1. Fetch PENDING violations in target states
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
    .in('state', ['aud', 'mgt', 'hr'])
    .eq('status_text', 'PENDING');

  if (error) throw error;
  if (!violations || violations.length === 0) return { sent: 0, reason: 'no_pending_violations' };

  // 2. Resolve responsible users for each state
  const digestMap = new Map<string, any[]>(); // email -> violations[]

  for (const v of violations) {
    const role = v.state === 'aud' ? 'auditor' : v.state === 'mgt' ? 'manager' : 'hr';
    const { data: users } = await supabase
      .from('users')
      .select('email')
      .eq('role', role)
      .eq('is_active', true);

    if (users) {
      for (const user of users) {
        if (user.email) {
          if (!digestMap.has(user.email)) digestMap.set(user.email, []);
          digestMap.get(user.email)!.push(v);
        }
      }
    }
  }

  // 3. Send digest emails
  let sentCount = 0;
  for (const [email, userViolations] of digestMap.entries()) {
    const subject = `ملخص المخالفات المعلقة بانتظارك - ATHAR`;
    
    const tableRows = userViolations.map(v => {
      const rawTicket = String(v.ticket_number || v.id);
      const formattedTicket = rawTicket.includes('-') ? rawTicket.split('-').pop() : rawTicket;
      return `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${formattedTicket}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${v.employee?.name || '—'}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${v.violation_type || '—'}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${new Date(v.created_at).toLocaleDateString('ar-SA')}</td>
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
        <p style="font-size: 12px; color: #777;">رسالة تلقائية من منصة أثر يرجى عدم الرد على هذا البريد</p>
      </div>
    `;

    const text = `ملخص المخالفات المعلقة بانتظارك: ${userViolations.length} مخالفات. يرجى الدخول للتطبيق.`;

    try {
      await sendEmail(email, subject, html, text);
      sentCount++;
    } catch (err) {
      console.error(`Failed to send digest to ${email}:`, err);
    }
  }

  return { sent: sentCount, total_violations: violations.length };
}
