import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Apple HM08: send ASCII text only (no HTML part at all).
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

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    const domain = senderDomain(SENDER_EMAIL);
    return json({
      ok: true,
      configured: {
        RESEND_API_KEY: Boolean(RESEND_API_KEY),
        SEND_EMAIL_HOOK_SECRET: Boolean(HOOK_SECRET),
        SENDER_EMAIL: Boolean(SENDER_EMAIL),
      },
      deliverability: {
        sender_domain: domain,
        uses_resend_shared_domain: domain === 'resend.dev',
        template: 'text-only-ascii',
        warning: domain === 'resend.dev'
          ? 'SENDER_EMAIL uses resend.dev. Verify athar-app.online in Resend and set SENDER_EMAIL to no-reply@athar-app.online for Apple/iCloud delivery.'
          : null,
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  if (!resend || !RESEND_API_KEY || !HOOK_SECRET || !SENDER_EMAIL) {
    console.error('send-auth-emails: missing RESEND_API_KEY, SEND_EMAIL_HOOK_SECRET, or SENDER_EMAIL');
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

    const { error } = await resend.emails.send({
      from: formatSender(SENDER_EMAIL),
      to: [user.email],
      subject: SUBJECT,
      text,
      html: '',
      tags: [{ name: 'category', value: 'password-reset' }],
    });

    if (error) {
      throw new Error((error as { message?: string }).message || 'Resend send failed');
    }

    console.log('send-auth-emails: recovery sent to ' + user.email);
    return json({ success: true });
  } catch (error) {
    console.error('send-auth-emails:', error);
    return json({
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
});
