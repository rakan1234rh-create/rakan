import { Resend } from 'npm:resend@4.0.0';
import { VIOLATION_EMAIL_HTML } from './violation-email-template.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const BREVO_FROM = Deno.env.get('BREVO_FROM') ?? Deno.env.get('SMTP_FROM') ?? SENDER_EMAIL;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

export const VIOLATION_EMAIL_ALERTS_KEY = 'violation_email_alerts_enabled';

const htmlTemplate = VIOLATION_EMAIL_HTML;

function escapeHtml(value: string): string {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parseSender(raw: string): { name: string; email: string } {
  const trimmed = raw.trim();
  const bracket = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (bracket) return { name: bracket[1].trim(), email: bracket[2].trim() };
  const email = trimmed.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? trimmed;
  return { name: 'ATHAR', email };
}

function formatSender(raw: string): string {
  const { name, email } = parseSender(raw);
  return `${name} <${email}>`;
}

function invisibleSubjectSuffix(ref: string): string {
  const n = (ref.charCodeAt(0) + ref.charCodeAt(ref.length - 1)) % 8 + 1;
  return '\u200C'.repeat(n);
}

function antiThreadHeaders(deliveryRef: string): Record<string, string> {
  return {
    'X-Entity-Ref-ID': deliveryRef,
    'X-ATHAR-Delivery': deliveryRef,
  };
}

function isAppleMailbox(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return APPLE_DOMAINS.has(domain);
}

function brevoConfigured(): boolean {
  return Boolean(BREVO_API_KEY && BREVO_FROM);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function parseViolationEmailAlertsEnabled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    try {
      return parseViolationEmailAlertsEnabled(JSON.parse(value));
    } catch {
      return value === 'true' || value === '1';
    }
  }
  if (typeof value === 'object') {
    const row = value as { enabled?: unknown };
    return row.enabled === true || row.enabled === 1 || row.enabled === 'true';
  }
  return false;
}

export async function isViolationEmailAlertsEnabled(
  supabase: { from: (table: string) => unknown },
): Promise<boolean> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { value?: unknown } | null; error?: { message: string } }>;
        };
      };
    };
  };
  const { data, error } = await client
    .from('platform_settings')
    .select('value')
    .eq('key', VIOLATION_EMAIL_ALERTS_KEY)
    .maybeSingle();
  if (error) {
    console.warn('violation-email: platform_settings read failed', error.message);
    return false;
  }
  return parseViolationEmailAlertsEnabled(data?.value);
}

export function buildViolationAlertEmail(opts: {
  recipientName: string;
  title: string;
  message: string;
}): { subject: string; html: string; text: string; deliveryRef: string } {
  const deliveryRef = crypto.randomUUID();
  const recipientName = escapeHtml(opts.recipientName || 'مستخدم');
  const title = escapeHtml(opts.title || 'تنبيه');
  const message = escapeHtml(opts.message || '');

  const htmlCore = (htmlTemplate || '')
    .replaceAll('{{RECIPIENT_NAME}}', recipientName)
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{MESSAGE}}', message);

  const html = htmlCore +
    `<!-- athar-delivery:${deliveryRef} -->` +
    `<div style="display:none!important;max-height:0;overflow:hidden;font-size:0;line-height:0;color:transparent;mso-hide:all" aria-hidden="true">&#8203;${deliveryRef}</div>`;

  const plainName = opts.recipientName || 'مستخدم';
  const plainTitle = opts.title || 'تنبيه';
  const plainMessage = opts.message || '';

  const text = [
    `مرحباً ${plainName}،`,
    '',
    plainTitle,
    '',
    plainMessage,
    '',
    '—',
    'رسالة تلقائية من منصة أثر. لا ترد على هذا البريد.',
    'افتح تطبيق أثر للاطلاع والمتابعة.',
  ].join('\n');

  return {
    subject: `${plainTitle} — ATHAR` + invisibleSubjectSuffix(deliveryRef),
    html,
    text,
    deliveryRef,
  };
}

async function sendViaBrevo(
  to: string,
  subject: string,
  html: string,
  text: string,
  deliveryRef: string,
): Promise<void> {
  const sender = parseSender(BREVO_FROM);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      headers: antiThreadHeaders(deliveryRef),
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Brevo API send failed (${response.status}): ${raw.slice(0, 200)}`);
  }
}

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
  deliveryRef: string,
): Promise<void> {
  if (!resend) throw new Error('Resend is not configured');
  const from = formatSender(SENDER_EMAIL);
  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html,
    text,
    headers: antiThreadHeaders(deliveryRef),
  });
  if (error) {
    throw new Error((error as { message?: string }).message || 'Resend send failed');
  }
}

async function deliverViolationEmail(to: string, title: string, message: string, recipientName: string) {
  if (!SENDER_EMAIL || (!resend && !brevoConfigured())) {
    throw new Error('Email provider not configured (RESEND_API_KEY or BREVO_API_KEY)');
  }
  if (!htmlTemplate?.trim()) throw new Error('Violation email template is empty');

  const built = buildViolationAlertEmail({ recipientName, title, message });
  const useBrevo = isAppleMailbox(to) && brevoConfigured();

  if (useBrevo) {
    await sendViaBrevo(to, built.subject, built.html, built.text, built.deliveryRef);
  } else if (resend) {
    await sendViaResend(to, built.subject, built.html, built.text, built.deliveryRef);
  } else if (brevoConfigured()) {
    await sendViaBrevo(to, built.subject, built.html, built.text, built.deliveryRef);
  } else {
    throw new Error('No email provider available');
  }
}

type EmailUserRow = { id: string; name?: string | null; email?: string | null };

export async function sendViolationEmailsToUserIds(
  supabase: { from: (table: string) => unknown },
  userIds: Set<string>,
  title: string,
  message: string,
): Promise<{ sent: number; errors?: string[] }> {
  if (!userIds.size) return { sent: 0 };

  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{ data: EmailUserRow[] | null; error?: { message: string } }>;
      };
    };
  };

  const { data: users, error } = await client
    .from('users')
    .select('id, name, email')
    .in('id', Array.from(userIds));

  if (error) return { sent: 0, errors: [error.message] };
  if (!users?.length) return { sent: 0 };

  let sent = 0;
  const errors: string[] = [];

  await Promise.all(users.map(async (user) => {
    const email = String(user.email || '').trim();
    if (!isValidEmail(email)) return;
    const name = String(user.name || '').trim() || 'مستخدم';
    try {
      await deliverViolationEmail(email, title, message, name);
      sent += 1;
    } catch (err) {
      errors.push(`${email}: ${String((err as Error)?.message || err).slice(0, 120)}`);
    }
  }));

  return {
    sent,
    errors: errors.length ? errors.slice(0, 3) : undefined,
  };
}
