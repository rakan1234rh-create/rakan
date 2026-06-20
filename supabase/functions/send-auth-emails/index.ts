import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';
const RECOVERY_TEMPLATE_ID = Deno.env.get('RESEND_RECOVERY_TEMPLATE_ID') ?? 'athar-recovery';

const resend = new Resend(RESEND_API_KEY);

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
  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  if (!RESEND_API_KEY || !HOOK_SECRET || !SENDER_EMAIL) {
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
      console.warn(`send-auth-emails: unsupported action ${action}`);
      return json({ success: true, skipped: action });
    }

    const token = String(email_data.token ?? '').trim();
    if (!token) {
      throw new Error('Recovery email missing token');
    }

    const confirmationUrl = email_data.redirect_to
      || `${email_data.site_url.replace(/\/$/, '')}/?type=recovery`;

    const { error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [user.email],
      subject: 'إعادة تعيين كلمة المرور — ATHAR',
      template: {
        id: RECOVERY_TEMPLATE_ID,
        variables: {
          TOKEN: token,
          CONFIRMATION_URL: confirmationUrl,
        },
      },
    });

    if (error) {
      throw new Error(error.message || 'Resend send failed');
    }

    console.log(`send-auth-emails: recovery sent to ${user.email}`);
    return json({ success: true });
  } catch (error) {
    console.error('send-auth-emails:', error);
    return json({
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
});
