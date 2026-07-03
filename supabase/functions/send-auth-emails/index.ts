import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import nodemailer from 'npm:nodemailer@6.9.16';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';

// Optional SMTP fallback for Apple/iCloud when Resend shared IPs bounce HM08.
const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '587');
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASSWORD') ?? Deno.env.get('SMTP_PASS') ?? '';
const SMTP_FROM = Deno.env.get('SMTP_FROM') ?? SENDER_EMAIL;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);
const SUBJECT = 'ATHAR account verification code';
const TEXT_TEMPLATE = [
  'Hello,',
  '',
  'Your ATHAR password reset code is: {{TOKEN}}',
  '',
  'Enter this code on the password reset page in the app.',
  '',
  'If you did not request this email, you can ignore it.',
].join('\n');

function formatSender(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('<')) return trimmed;
  const address = trimmed.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? trimmed;
  return `ATHAR <${address}>`;
}

function senderDomain(raw: string): string | null {
  const match = raw.match(/@([^>\s]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function isAppleMailbox(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return APPLE_DOMAINS.has(domain);
}

function smtpConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

type EmailActionType = 'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change' | 'email';

type WebhookPayload = {
  user: { id: string; email: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: EmailActionType;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function smtpErrorMessage(error: unknown): string {
  const err = error as { message?: string; response?: string; responseCode?: number };
  const parts = [err.message, err.response].filter(Boolean).map(String);
  const combined = parts.join(' — ').trim();
  if (!combined) return 'SMTP send failed';

  if (/sender|from|not valid|not verified|authentication domain|domain not/i.test(combined)) {
    return (
      'Brevo rejected the sender address (' +
      SMTP_FROM +
      '). In Brevo → Senders, Domains & Dedicated IPs, verify no-reply@athar-app.online or authenticate athar-app.online with DNS. Details: ' +
      combined
    );
  }

  return 'SMTP send failed: ' + combined;
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    requireTLS: SMTP_PORT === 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    const info = await transport.sendMail({
      from: formatSender(SMTP_FROM),
      to,
      subject,
      text,
    });

    console.log('send-auth-emails: smtp sent id=' + String(info.messageId ?? '') + ' to ' + to);
  } catch (error) {
    throw new Error(smtpErrorMessage(error));
  }
}

async function sendViaResend(to: string, subject: string, text: string): Promise<void> {
  if (!resend) {
    throw new Error('Resend is not configured');
  }

  const { error } = await resend.emails.send({
    from: formatSender(SENDER_EMAIL),
    to: [to],
    subject,
    text,
  });

  if (error) {
    throw new Error((error as { message?: string }).message || 'Resend send failed');
  }

  console.log('send-auth-emails: resend sent to ' + to);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    const domain = senderDomain(SENDER_EMAIL);
    const smtpReady = smtpConfigured();
    return json({
      ok: true,
      configured: {
        RESEND_API_KEY: Boolean(RESEND_API_KEY),
        SEND_EMAIL_HOOK_SECRET: Boolean(HOOK_SECRET),
        SENDER_EMAIL: Boolean(SENDER_EMAIL),
        SMTP_FALLBACK: smtpReady,
      },
      deliverability: {
        sender_domain: domain,
        uses_resend_shared_domain: domain === 'resend.dev',
        template: 'text-only-ascii',
        apple_mail_route: smtpReady ? 'smtp' : 'resend',
        apple_hm08_risk_without_smtp: !smtpReady,
        warning: !smtpReady
          ? 'Apple/iCloud (icloud.com, me.com, mac.com) may bounce HM08 on Resend shared IPs. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM in Supabase Secrets.'
          : null,
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  if (!HOOK_SECRET || !SENDER_EMAIL || (!resend && !smtpConfigured())) {
    console.error('send-auth-emails: missing email provider configuration');
    return json({ error: { message: 'Email hook is not configured' } }, 500);
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const wh = new Webhook(HOOK_SECRET.replace('v1,whsec_', ''));

  try {
    const { user, email_data } = wh.verify(payload, headers) as WebhookPayload;
    const action = email_data.email_action_type;

    if (action !== 'recovery') {
      console.warn('send-auth-emails: unsupported action ' + action);
      return json({ success: true, skipped: action });
    }

    const token = String(email_data.token ?? '').trim();
    if (!token) {
      throw new Error('Recovery email missing token');
    }

    const text = TEXT_TEMPLATE.replaceAll('{{TOKEN}}', token);
    const apple = isAppleMailbox(user.email);
    const useSmtp = apple && smtpConfigured();

    if (apple && !smtpConfigured()) {
      console.warn(
        'send-auth-emails: Apple mailbox without SMTP fallback — Resend may bounce HM08 for ' + user.email,
      );
    }

    if (useSmtp) {
      await sendViaSmtp(user.email, SUBJECT, text);
    } else {
      await sendViaResend(user.email, SUBJECT, text);
    }

    return json({ success: true, provider: useSmtp ? 'smtp' : 'resend' });
  } catch (error) {
    console.error('send-auth-emails:', error);
    return json({
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
});
