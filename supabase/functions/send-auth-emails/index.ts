import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '';
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') ?? '';
const SMTP_HOST = (Deno.env.get('SES_SMTP_HOST') || Deno.env.get('SMTP_HOST') || '').trim();
const SMTP_USER = (Deno.env.get('SES_SMTP_USERNAME') || Deno.env.get('SMTP_USERNAME') || '').trim();
const SMTP_PASS = (Deno.env.get('SES_SMTP_PASSWORD') || Deno.env.get('SMTP_PASSWORD') || '').trim();
const SMTP_PORT = Number(Deno.env.get('SES_SMTP_PORT') || Deno.env.get('SMTP_PORT') || 465);

const smtpConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

// Arabic recovery template — see supabase/email-templates/athar-recovery-simple.html
const HTML_B64 = 'PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9ImFyIiBkaXI9InJ0bCI+CjxoZWFkPgogIDxtZXRhIGNoYXJzZXQ9InV0Zi04Ij4KICA8bWV0YSBuYW1lPSJ2aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTEuMCI+CjwvaGVhZD4KPGJvZHkgc3R5bGU9Im1hcmdpbjowO3BhZGRpbmc6MDtiYWNrZ3JvdW5kOiNmZmZmZmY7Ij4KICA8ZGl2IGRpcj0icnRsIiBzdHlsZT0iZm9udC1mYW1pbHk6VGFob21hLEFyaWFsLHNhbnMtc2VyaWY7bGluZS1oZWlnaHQ6MS43O2NvbG9yOiMyMjI7bWF4LXdpZHRoOjQ4MHB4O21hcmdpbjowIGF1dG87cGFkZGluZzoyOHB4IDIwcHg7Ij4KICAgIDxwIHN0eWxlPSJtYXJnaW46MCAwIDhweDtmb250LXNpemU6MThweDtmb250LXdlaWdodDo3MDA7Ij5BVEhBUjwvcD4KICAgIDxwIHN0eWxlPSJtYXJnaW46MCAwIDIwcHg7Zm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwOyI+2KfYs9iq2LnYp9iv2Kkg2YPZhNmF2Kkg2KfZhNmF2LHZiNixPC9wPgogICAgPHAgc3R5bGU9Im1hcmdpbjowIDAgMTZweDtmb250LXNpemU6MTVweDsiPtiq2YTZgtmK2YbYpyDYt9mE2KjYpyDZhNin2LnYp9iv2Kkg2KrYudmK2YrZhiDZg9mE2YXYqSDYp9mE2YXYsdmI2LEg2YTYrdiz2KfYqNmDINmB2Yog2YXZhti12Kkg2KfYq9ixLjwvcD4KICAgIDxwIHN0eWxlPSJtYXJnaW46MCAwIDhweDtmb250LXNpemU6MTRweDsiPtix2YXYsiDYp9mE2KrYrdmC2YI6PC9wPgogICAgPHAgZGlyPSJsdHIiIHN0eWxlPSJtYXJnaW46MCAwIDIwcHg7Zm9udC1zaXplOjI4cHg7Zm9udC13ZWlnaHQ6NzAwO2xldHRlci1zcGFjaW5nOjAuMTJlbTtmb250LWZhbWlseTpDb25zb2xhcyxNZW5sbyxtb25vc3BhY2U7Ij57e1RPS0VOfX08L3A+CiAgICA8cCBzdHlsZT0ibWFyZ2luOjAgMCAxNnB4O2ZvbnQtc2l6ZToxNHB4OyI+2KfYr9iu2YQg2KfZhNix2YXYsiDZgdmKINi12YHYrdipINin2LPYqti52KfYr9ipINmD2YTZhdipINin2YTZhdix2YjYsSDYr9in2K7ZhCDYp9mE2YXZhti12KkuPC9wPgogICAgPHAgc3R5bGU9Im1hcmdpbjowIDAgOHB4O2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM1NTU7Ij7Yp9iw2Kcg2YTZhSDYqti32YTYqCDYsNmE2YPYjCDYqtis2KfZh9mEINmH2LDZhyDYp9mE2LHYs9in2YTYqS48L3A+CiAgICA8cCBzdHlsZT0ibWFyZ2luOjAgMCAyNHB4O2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM1NTU7Ij7Yp9mE2LHZhdiyINi12KfZhNitINmE2YXYsdipINmI2KfYrdiv2Kkg2YjZhNmF2K/YqSDZhdit2K/ZiNiv2KkuPC9wPgogICAgPHAgc3R5bGU9Im1hcmdpbjowO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiM3Nzc7Ij4KICAgICAgPGEgaHJlZj0ie3tVTlNVQlNDUklCRV9VUkx9fSIgc3R5bGU9ImNvbG9yOiM1NTU7Ij7Yp9mE2LrYp9ihINin2YTYp9i02KrYsdin2YM8L2E+CiAgICAgIMK3IEFUSEFSIMK3IGF0aGFyLWFwcC5vbmxpbmUKICAgIDwvcD4KICA8L2Rpdj4KPC9ib2R5Pgo8L2h0bWw+Cg==';
const SUBJECT_B64 = '2KfYs9iq2LnYp9iv2Kkg2YPZhNmF2Kkg2KfZhNmF2LHZiNixIOKAlCBBVEhBUg==';
const TEXT_B64 = '2LHZhdiyINin2LPYqti52KfYr9ipINmD2YTZhdipINin2YTZhdix2YjYsSDYp9mE2K7Yp9i1INio2YM6IHt7VE9LRU59fQoK2KfYr9iu2YQg2KfZhNix2YXYsiDZgdmKINi12YHYrdipINin2LPYqti52KfYr9ipINmD2YTZhdipINin2YTZhdix2YjYsSDYr9in2K7ZhCDYp9mE2YXZhti12KkuINin2YTYsdmF2LIg2LXYp9mE2K0g2YTZhdix2Kkg2YjYp9it2K/YqSDZiNmE2YXYr9ipINmF2K3Yr9mI2K/YqS4KCtin2YTYutin2KEg2KfZhNin2LTYqtix2KfZgzoge3tVTlNVQlNDUklCRV9VUkx9fQoKQVRIQVIgwrcgYXRoYXItYXBwLm9ubGluZQ==';

function b64utf8(b64: string): string {
  const clean = String(b64 || '').replace(/\s+/g, '');
  const bin = atob(clean);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

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

const APPLE_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);

function isAppleMailbox(email: string): boolean {
  const domain = String(email || '').split('@').pop()?.toLowerCase() || '';
  return APPLE_DOMAINS.has(domain);
}

function publicAppOrigin(): string {
  return (Deno.env.get('ATHAR_PUBLIC_ORIGIN') || 'https://vms-v2.aromaticfamilies.com').replace(/\/$/, '');
}

function unsubscribeUrlFor(to: string): string {
  return `${publicAppOrigin()}/?unsubscribe=${encodeURIComponent(to || '')}`;
}

/** Ultra-plain text for Apple HM08 content filters: no HTML, no https links. */
function buildAppleRecoveryEmail(token: string, to = ''): { subject: string; html?: string; text: string; deliveryRef: string } {
  const deliveryRef = crypto.randomUUID();
  const { email: fromEmail } = parseSender(SENDER_EMAIL);
  const unsubMail = fromEmail || 'info@athar-app.online';
  const text = [
    'مرحبا،',
    '',
    `رمز حسابك في منصة اثر هو: ${token}`,
    '',
    'اكتب الرمز داخل صفحة الاستعادة في المنصة فقط.',
    'اذا لم تطلب الرمز فتجاهل هذه الرسالة.',
    '',
    `لوقف رسائل التنبيه ارسل بريدا الى ${unsubMail} بعنوان unsubscribe`,
    '',
    'منصة اثر',
    to ? `الى: ${to}` : '',
  ].filter(Boolean).join('\n');

  return {
    subject: 'رمز حسابك في منصة اثر',
    text,
    deliveryRef,
  };
}

function buildRecoveryEmail(token: string, to = ''): { subject: string; html?: string; text: string; deliveryRef: string } {
  if (isAppleMailbox(to)) return buildAppleRecoveryEmail(token, to);

  const deliveryRef = crypto.randomUUID();
  const unsub = unsubscribeUrlFor(to);
  return {
    subject: b64utf8(SUBJECT_B64),
    html: b64utf8(HTML_B64).replaceAll('{{TOKEN}}', token).replaceAll('{{UNSUBSCRIBE_URL}}', unsub),
    text: b64utf8(TEXT_B64).replaceAll('{{TOKEN}}', token).replaceAll('{{UNSUBSCRIBE_URL}}', unsub),
    deliveryRef,
  };
}

function emailHeaders(deliveryRef: string, to: string, apple: boolean): Record<string, string> {
  const { email: fromEmail } = parseSender(SENDER_EMAIL);
  const mailto = `mailto:${fromEmail || 'info@athar-app.online'}?subject=unsubscribe`;
  if (apple) {
    // Avoid https + one-click headers that Apple may treat as bulk/spam signals on OTP mail.
    return {
      'X-Entity-Ref-ID': deliveryRef,
      'List-Unsubscribe': `<${mailto}>`,
    };
  }
  const unsubscribeUrl = unsubscribeUrlFor(to);
  return {
    'X-Entity-Ref-ID': deliveryRef,
    'List-Unsubscribe': `<${mailto}>, <${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
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

async function sendViaSmtp(
  to: string,
  subject: string,
  html: string | undefined,
  text: string,
  deliveryRef: string,
): Promise<void> {
  if (!smtpConfigured) throw new Error('SMTP is not configured');
  const nodemailer = await import('npm:nodemailer@6.9.16');
  // Auth Send Email Hook has a short timeout — use a single fast SMTP attempt.
  const port = Number.isFinite(SMTP_PORT) && SMTP_PORT > 0 ? SMTP_PORT : 587;
  const apple = isAppleMailbox(to);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  });
  await transporter.sendMail({
    from: apple
      ? `منصة اثر <${parseSender(SENDER_EMAIL).email || SMTP_USER}>`
      : formatSender(SENDER_EMAIL || `ATHAR <${SMTP_USER}>`),
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    headers: emailHeaders(deliveryRef, to, apple),
  });
  console.log('send-auth-emails: smtp sent to ' + to + ' via ' + SMTP_HOST + ':' + port + (apple ? ' apple-plain' : ''));
}

async function deliverRecovery(to: string, token: string): Promise<string> {
  const mail = buildRecoveryEmail(token, to);
  await sendViaSmtp(to, mail.subject, mail.html, mail.text, mail.deliveryRef);
  return 'smtp';
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('health') === '1') {
    // Booleans only — never expose SMTP credentials or send test mail from this endpoint.
    return json({
      ok: true,
      configured: {
        SEND_EMAIL_HOOK_SECRET: Boolean(HOOK_SECRET),
        SENDER_EMAIL: Boolean(SENDER_EMAIL),
        SMTP: smtpConfigured,
      },
      deliverability: {
        sender_domain: senderDomain(SENDER_EMAIL),
        template: 'apple-text-only-no-https; others-html-unsub',
        primary_route: 'smtp-hostinger',
        note: 'Hostinger SMTP only.',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 });
  }

  if (!HOOK_SECRET || !SENDER_EMAIL || !smtpConfigured) {
    console.error('send-auth-emails: missing email configuration');
    return json({ error: { message: 'Email provider is not configured' } }, 500);
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
    if (!token) throw new Error('Recovery email missing token');

    // Auth HTTP hooks must finish in ~5s. Hostinger SMTP often needs longer,
    // so return success quickly and finish sending in the background if needed.
    const sendPromise = deliverRecovery(user.email, token);
    const outcome = await Promise.race([
      sendPromise.then((provider) => ({ status: 'done' as const, provider })),
      new Promise<{ status: 'pending' }>((resolve) => {
        setTimeout(() => resolve({ status: 'pending' }), 3500);
      }),
    ]);

    if (outcome.status === 'pending') {
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) {
        runtime.waitUntil(sendPromise.catch((err: unknown) => {
          console.error('send-auth-emails: background send failed', err);
        }));
      } else {
        sendPromise.catch((err: unknown) => {
          console.error('send-auth-emails: background send failed', err);
        });
      }
      console.log('send-auth-emails: returning early; SMTP continuing in background to ' + user.email);
      return json({ success: true, provider: 'smtp-background' });
    }

    return json({ success: true, provider: outcome.provider });
  } catch (error) {
    console.error('send-auth-emails:', error);
    return json({
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    }, 500);
  }
});
