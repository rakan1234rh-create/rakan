import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';

// Lazy init: constructing Resend with an empty key throws at module load,
// which would crash the whole function (WORKER_ERROR) on every request.
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Email content is stored base64-encoded (UTF-8) to keep this source ASCII-safe.
// Rendered inline so we do not depend on the Resend Templates feature.
const HTML_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImFyIiBkaXI9InJ0bCI+CjxoZWFkPgo8bWV0YSBjaGFyc2V0PSJ1dGYtOCI+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xIj4KPG1ldGEgbmFtZT0iY29sb3Itc2NoZW1lIiBjb250ZW50PSJsaWdodCBvbmx5Ij4KPG1ldGEgbmFtZT0ic3VwcG9ydGVkLWNvbG9yLXNjaGVtZXMiIGNvbnRlbnQ9ImxpZ2h0IG9ubHkiPgo8L2hlYWQ+Cjxib2R5IHN0eWxlPSJtYXJnaW46MDtwYWRkaW5nOjA7YmFja2dyb3VuZC1jb2xvcjojZjVmNWY1OyI+Cjx0YWJsZSByb2xlPSJwcmVzZW50YXRpb24iIHdpZHRoPSIxMDAlIiBjZWxsc3BhY2luZz0iMCIgY2VsbHBhZGRpbmc9IjAiIGJvcmRlcj0iMCIgc3R5bGU9ImJhY2tncm91bmQtY29sb3I6I2Y1ZjVmNTtmb250LWZhbWlseTpTZWdvZSBVSSxUYWhvbWEsQXJpYWwsc2Fucy1zZXJpZjsiPgogIDx0cj4KICAgIDx0ZCBhbGlnbj0iY2VudGVyIiBzdHlsZT0icGFkZGluZzoyOHB4IDE2cHg7YmFja2dyb3VuZC1jb2xvcjojZjVmNWY1OyI+CiAgICAgIDx0YWJsZSByb2xlPSJwcmVzZW50YXRpb24iIHdpZHRoPSIxMDAlIiBjZWxsc3BhY2luZz0iMCIgY2VsbHBhZGRpbmc9IjAiIGJvcmRlcj0iMCIgYmdjb2xvcj0iI2ZmZmZmZiIgc3R5bGU9Im1heC13aWR0aDozNjBweDtiYWNrZ3JvdW5kLWNvbG9yOiNmZmZmZmY7Ym9yZGVyLXJhZGl1czoxNHB4O2JvcmRlcjoxcHggc29saWQgI2U0ZTRlNzsiPgogICAgICAgIDx0cj4KICAgICAgICAgIDx0ZCBhbGlnbj0iY2VudGVyIiBiZ2NvbG9yPSIjZmZmZmZmIiBzdHlsZT0icGFkZGluZzoyMnB4IDI0cHggNnB4O2JhY2tncm91bmQtY29sb3I6I2ZmZmZmZjsiPgogICAgICAgICAgICA8aW1nIHNyYz0iaHR0cHM6Ly9yYWthbjEyMzRyaC1jcmVhdGUuZ2l0aHViLmlvL3Jha2FuL2ljb25zL2F0aGFyLXdvcmRtYXJrLWVtYWlsLXYzODgucG5nP3Y9MiIgd2lkdGg9IjE2MCIgaGVpZ2h0PSI5OSIgYWx0PSJBVEhBUiIgc3R5bGU9ImRpc3BsYXk6YmxvY2s7d2lkdGg6MTYwcHg7bWF4LXdpZHRoOjYwJTtoZWlnaHQ6YXV0bztib3JkZXI6MDttYXJnaW46MCBhdXRvOyI+CiAgICAgICAgICA8L3RkPgogICAgICAgIDwvdHI+CiAgICAgICAgPHRyPgogICAgICAgICAgPHRkIGRpcj0icnRsIiBiZ2NvbG9yPSIjZmZmZmZmIiBzdHlsZT0icGFkZGluZzo2cHggMjRweCAyNHB4O3RleHQtYWxpZ246cmlnaHQ7YmFja2dyb3VuZC1jb2xvcjojZmZmZmZmOyI+CiAgICAgICAgICAgIDxwIHN0eWxlPSJtYXJnaW46MCAwIDEycHg7Zm9udC1zaXplOjE1cHg7bGluZS1oZWlnaHQ6MS43O2NvbG9yOiMxODE4MWI7Ij7Zhdix2K3YqNin2YvYjDwvcD4KICAgICAgICAgICAgPHAgc3R5bGU9Im1hcmdpbjowIDAgMThweDtmb250LXNpemU6MTRweDtsaW5lLWhlaWdodDoxLjc7Y29sb3I6IzNmM2Y0NjsiPtiq2YTZgtmR2YrZhtinINi32YTYqNin2Ysg2YTYpdi52KfYr9ipINiq2LnZitmK2YYg2YPZhNmF2Kkg2KfZhNmF2LHZiNixINmE2K3Ys9in2KjZgy48L3A+CiAgICAgICAgICAgIDxwIHN0eWxlPSJtYXJnaW46MCAwIDhweDtmb250LXNpemU6MTNweDtsaW5lLWhlaWdodDoxLjY7Y29sb3I6IzNmM2Y0Njt0ZXh0LWFsaWduOmNlbnRlcjsiPtix2YXYsiDYp9mE2KrYrdmC2YIg2KfZhNiu2KfYtSDYqNmDPC9wPgogICAgICAgICAgICA8cCBkaXI9Imx0ciIgc3R5bGU9Im1hcmdpbjowIDAgMThweDt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MjRweDtsZXR0ZXItc3BhY2luZzowLjE1ZW07Zm9udC13ZWlnaHQ6ODAwO2NvbG9yOiMxODE4MWI7YmFja2dyb3VuZC1jb2xvcjojZmFmYWZhO2JvcmRlcjoxcHggc29saWQgI2U0ZTRlNztib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMnB4IDE0cHg7Ij57e1RPS0VOfX08L3A+CiAgICAgICAgICAgIDxwIHN0eWxlPSJtYXJnaW46MCAwIDE0cHg7Zm9udC1zaXplOjEycHg7bGluZS1oZWlnaHQ6MS42O2NvbG9yOiM3MTcxN2E7dGV4dC1hbGlnbjpjZW50ZXI7Ij7Yp9mD2KrYqCDZh9iw2Kcg2KfZhNix2YXYsiDZgdmKINi12YHYrdipINin2LPYqti52KfYr9ipINmD2YTZhdipINin2YTZhdix2YjYsSDYr9in2K7ZhCDYp9mE2YXZhti12KkuPC9wPgogICAgICAgICAgICA8cCBzdHlsZT0ibWFyZ2luOjAgMCA4cHg7Zm9udC1zaXplOjEycHg7bGluZS1oZWlnaHQ6MS42O2NvbG9yOiM3MTcxN2E7Ij7Ypdiw2Kcg2YTZhSDYqti32YTYqCDYsNmE2YPYjCDYqtis2KfZh9mEINmH2LDZhyDYp9mE2LHYs9in2YTYqS48L3A+CiAgICAgICAgICAgIDxwIHN0eWxlPSJtYXJnaW46MDtmb250LXNpemU6MTFweDtsaW5lLWhlaWdodDoxLjY7Y29sb3I6IzcxNzE3YTsiPtin2YTYsdmF2LIg2LXYp9mE2K0g2YTZhdix2Kkg2YjYp9it2K/YqSDZiNmE2YXYr9ipINmF2K3Yr9mI2K/YqS48L3A+CiAgICAgICAgICA8L3RkPgogICAgICAgIDwvdHI+CiAgICAgIDwvdGFibGU+CiAgICA8L3RkPgogIDwvdHI+CjwvdGFibGU+CjwvYm9keT4KPC9odG1sPg==';
const SUBJECT_B64 = '2KXYudin2K/YqSDYqti52YrZitmGINmD2YTZhdipINin2YTZhdix2YjYsSDigJQgQVRIQVI=';
const TEXT_B64 = '2LHZhdiyINil2LnYp9iv2Kkg2KrYudmK2YrZhiDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2KfZhNiu2KfYtSDYqNmDOiB7e1RPS0VOfX0g4oCUINin2YPYqtio2Ycg2YHZiiDYtdmB2K3YqSDYp9iz2KrYudin2K/YqSDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2K/Yp9iu2YQg2KfZhNmF2YbYtdipLiDYtdin2YTYrSDZhNmF2LHYqSDZiNin2K3Yr9ipINmI2YTZhdiv2Kkg2YXYrdiv2YjYr9ipLg==';

function b64utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** موضوع فريد لكل رسالة — يمنع Gmail من تجميعها في محادثة واحدة */
function buildRecoverySubject(): string {
  const base = b64utf8(SUBJECT_B64);
  const stamp = new Date().toLocaleString('ar-SA', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const ref = crypto.randomUUID().slice(0, 6);
  return `${base} · ${stamp} · ${ref}`;
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
    const subject = buildRecoverySubject();
    const threadId = crypto.randomUUID();

    const { error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [user.email],
      subject,
      html,
      text,
      headers: {
        'X-Entity-Ref-ID': threadId,
      },
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
