import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';

// Lazy init: constructing Resend with an empty key throws at module load,
// which would crash the whole function (WORKER_ERROR) on every request.
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Plain-text-first recovery email (Apple 554 5.7.1 HM08):
// - No images, links, tables, or embedded CSS.
// - No special Unicode punctuation in the subject (use ASCII hyphen only).
// - No per-message obfuscation headers.
const HTML_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImFyIiBkaXI9InJ0bCI+CjxoZWFkPgogIDxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KPC9oZWFkPgo8Ym9keSBzdHlsZT0iZm9udC1mYW1pbHk6QXJpYWwsVGFob21hLHNhbnMtc2VyaWY7Zm9udC1zaXplOjE2cHg7Y29sb3I6IzIyMjIyMjtsaW5lLWhlaWdodDoxLjY7bWFyZ2luOjIwcHg7Ij4KICA8cD7Zhdix2K3YqNin2YvYjDwvcD4KICA8cD7Yt9mE2Kgg2KfYs9iq2LnYp9iv2Kkg2YPZhNmF2Kkg2KfZhNmF2LHZiNixINmE2K3Ys9in2KjZgyDZgdmKIEFUSEFSLjwvcD4KICA8cD7YsdmF2LIg2KfZhNiq2K3ZgtmCOiA8c3Ryb25nIGRpcj0ibHRyIj57e1RPS0VOfX08L3N0cm9uZz48L3A+CiAgPHA+2KPYr9iu2YQg2KfZhNix2YXYsiDZgdmKINi12YHYrdipINin2LPYqti52KfYr9ipINmD2YTZhdipINin2YTZhdix2YjYsSDYr9in2K7ZhCDYp9mE2YXZhti12KkuPC9wPgogIDxwPtil2LDYpyDZhNmFINiq2LfZhNioINiw2YTZg9iMINiq2KzYp9mH2YQg2YfYsNmHINin2YTYsdiz2KfZhNipLjwvcD4KPC9ib2R5Pgo8L2h0bWw+Cg==';
const SUBJECT_B64 = '2LHZhdiyINin2YTYqtit2YLZgiAtIEFUSEFS';
const TEXT_B64 = '2YXYsdit2KjYp9mL2IwKCti32YTYqCDYp9iz2KrYudin2K/YqSDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2YTYrdiz2KfYqNmDINmB2YogQVRIQVIuCgrYsdmF2LIg2KfZhNiq2K3ZgtmCOiB7e1RPS0VOfX0KCtij2K/YrtmEINin2YTYsdmF2LIg2YHZiiDYtdmB2K3YqSDYp9iz2KrYudin2K/YqSDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2K/Yp9iu2YQg2KfZhNmF2YbYtdipLgoK2KXYsNinINmE2YUg2KrYt9mE2Kgg2LDZhNmD2Iwg2KrYrNin2YfZhCDZh9iw2Ycg2KfZhNix2LPYp9mE2Kku';

function b64utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

  // Health probe: reports which secrets are present (booleans only, no values).
  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    return json({
      ok: true,
      configured: {
        RESEND_API_KEY: Boolean(RESEND_API_KEY),
        SEND_EMAIL_HOOK_SECRET: Boolean(HOOK_SECRET),
        SENDER_EMAIL: Boolean(SENDER_EMAIL),
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

    const html = b64utf8(HTML_B64).replaceAll('{{TOKEN}}', token);
    const text = b64utf8(TEXT_B64).replaceAll('{{TOKEN}}', token);
    const subject = b64utf8(SUBJECT_B64);

    const { error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [user.email],
      subject,
      text,
      html,
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
