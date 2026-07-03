import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';

// Brevo HTTP API for Apple/iCloud — Supabase Edge Functions block SMTP ports 25/465/587.
const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const BREVO_FROM = Deno.env.get('BREVO_FROM') ?? Deno.env.get('SMTP_FROM') ?? SENDER_EMAIL;

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

function parseSender(raw: string): { name: string; email: string } {
  const trimmed = raw.trim();
  const bracket = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (bracket) {
    return { name: bracket[1].trim(), email: bracket[2].trim() };
  }
  const email = trimmed.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? trimmed;
  return { name: 'ATHAR', email };
}

function formatSender(raw: string): string {
  const { name, email } = parseSender(raw);
  return `${name} <${email}>`;
}

function senderDomain(raw: string): string | null {
  const { email } = parseSender(raw);
  const match = email.match(/@([^>\s]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function isAppleMailbox(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return APPLE_DOMAINS.has(domain);
}

function brevoConfigured(): boolean {
  return Boolean(BREVO_API_KEY && BREVO_FROM);
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

async function sendViaBrevo(to: string, subject: string, text: string): Promise<void> {
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
      textContent: text,
    }),
  });

  const body = await response.json().catch(() => ({})) as { message?: string; code?: string };

  if (!response.ok) {
    const detail = body.message || body.code || response.statusText;
    if (/sender|not valid|not verified|domain/i.test(detail)) {
      throw new Error(
        'Brevo rejected sender ' + sender.email +
        '. Verify athar-app.online and no-reply@athar-app.online in Brevo. Details: ' + detail,
      );
    }
    throw new Error('Brevo API send failed: ' + detail);
  }

  console.log('send-auth-emails: brevo sent to ' + to);
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
    const brevoReady = brevoConfigured();
    return json({
      ok: true,
      configured: {
        RESEND_API_KEY: Boolean(RESEND_API_KEY),
        SEND_EMAIL_HOOK_SECRET: Boolean(HOOK_SECRET),
        SENDER_EMAIL: Boolean(SENDER_EMAIL),
        BREVO_API_KEY: Boolean(BREVO_API_KEY),
        BREVO_FROM: Boolean(BREVO_FROM),
        BREVO_FALLBACK: brevoReady,
      },
      deliverability: {
        sender_domain: domain,
        uses_resend_shared_domain: domain === 'resend.dev',
        template: 'text-only-ascii',
        apple_mail_route: brevoReady ? 'brevo-api' : 'resend',
        apple_hm08_risk_without_brevo: !brevoReady,
        note: 'Supabase Edge Functions cannot use SMTP ports 25/465/587. Use BREVO_API_KEY (HTTP API), not SMTP.',
        warning: !brevoReady
          ? 'Apple/iCloud may bounce on Resend (HM08). Add BREVO_API_KEY and BREVO_FROM in Supabase Secrets.'
          : null,
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  if (!HOOK_SECRET || !SENDER_EMAIL || (!resend && !brevoConfigured())) {
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
    const useBrevo = apple && brevoConfigured();

    if (apple && !brevoConfigured()) {
      console.warn(
        'send-auth-emails: Apple mailbox without Brevo fallback — Resend may bounce HM08 for ' + user.email,
      );
    }

    if (useBrevo) {
      await sendViaBrevo(user.email, SUBJECT, text);
    } else {
      await sendViaResend(user.email, SUBJECT, text);
    }

    return json({ success: true, provider: useBrevo ? 'brevo' : 'resend' });
  } catch (error) {
    console.error('send-auth-emails:', error);
    return json({
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
});
