// Public email opt-out for ATHAR alert/digest mail (not auth OTP).
// Signed ?t= tokens only — raw-email unsubscribe is rejected (prevents preference takeover).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { verifyUnsubscribeToken } from '../_shared/unsubscribe-token.ts';

function buildCors(req: Request): Record<string, string> {
  const raw = Deno.env.get('ALLOWED_ORIGIN') || 'https://athar-app.online';
  const allowed = new Set(
    raw.split(',').map((s) => s.trim()).filter(Boolean).concat([
      'https://athar-app.online',
      'https://athar.app',
      // Temporary CORS allowlist only — not used for mail/unsubscribe link generation.
      'https://vms-v2.aromaticfamilies.com',
    ]),
  );
  const requestOrigin = req.headers.get('Origin') || '';
  const isAllowed = !requestOrigin
    || allowed.has(requestOrigin)
    || (requestOrigin.endsWith('.aromaticfamilies.com') && requestOrigin.startsWith('https://'));
  return {
    'Access-Control-Allow-Origin': isAllowed ? (requestOrigin || '*') : '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, list-unsubscribe, list-unsubscribe-post',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function normalizeEmail(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function htmlPage(title: string, body: string, lang = 'en'): Response {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f5f7;color:#1c1c21;margin:0;padding:2rem;line-height:1.7}main{max-width:28rem;margin:3rem auto;background:#fff;padding:1.5rem 1.25rem;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}h1{font-size:1.25rem;margin:0 0 .75rem}p{margin:0;color:#444}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function resolveSignedRequest(req: Request): Promise<{
  email: string;
  channel: string;
  source: string;
  error?: 'missing_token' | 'invalid_token';
}> {
  const url = new URL(req.url);
  let token = (url.searchParams.get('t') || url.searchParams.get('token') || '').trim();
  let bodyChannel = '';
  let source = req.method === 'GET' ? 'token' : 'one-click';

  if (req.method === 'POST') {
    const ct = (req.headers.get('content-type') || '').toLowerCase();
    try {
      if (ct.includes('application/json')) {
        const body = await req.json();
        token = String(body?.t || body?.token || token || '').trim();
        bodyChannel = normalizeEmail(body?.channel || '') || '';
        source = 'app';
      } else {
        const text = await req.text();
        const params = new URLSearchParams(text);
        token = String(params.get('t') || params.get('token') || token || '').trim();
        bodyChannel = normalizeEmail(params.get('channel') || '') || '';
        if (params.get('List-Unsubscribe') || /List-Unsubscribe=One-Click/i.test(text)) {
          source = 'one-click';
        }
      }
    } catch {
      // keep query token
    }
  }

  if (!token) {
    return { email: '', channel: 'alerts', source, error: 'missing_token' };
  }

  const claims = await verifyUnsubscribeToken(token);
  if (!claims) {
    return { email: '', channel: 'alerts', source, error: 'invalid_token' };
  }

  let channel = bodyChannel || claims.channel || 'alerts';
  if (channel !== 'digest' && channel !== 'all') channel = 'alerts';

  return {
    email: claims.email,
    channel,
    source,
  };
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const resolved = await resolveSignedRequest(req);
  const wantsHtml = (req.headers.get('accept') || '').includes('text/html') || req.method === 'GET';

  if (resolved.error === 'missing_token' || resolved.error === 'invalid_token') {
    // Reject unsigned / raw-email attempts — do not call record RPC.
    if (wantsHtml) {
      return htmlPage(
        'Unsubscribe',
        resolved.error === 'missing_token'
          ? 'This unsubscribe link is incomplete. Open the signed link from your email.'
          : 'This unsubscribe link is invalid or has expired.',
        'en',
      );
    }
    return new Response(JSON.stringify({
      ok: false,
      error: resolved.error === 'missing_token' ? 'missing_token' : 'invalid_token',
    }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!isValidEmail(resolved.email)) {
    if (wantsHtml) {
      return htmlPage('Unsubscribe', 'This unsubscribe link is incomplete or invalid.', 'en');
    }
    return new Response(JSON.stringify({ ok: false, error: 'invalid_email' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    || Deno.env.get('SUPABASE_SECRET_KEY')
    || '';
  if (!supabaseUrl || !serviceKey) {
    if (wantsHtml) {
      return htmlPage('Unsubscribe', 'Server configuration is incomplete. Please try again later.', 'en');
    }
    return new Response(JSON.stringify({ ok: false, error: 'server_misconfigured' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc('athar_record_email_unsubscribe', {
    p_email: resolved.email,
    p_channel: resolved.channel,
    p_source: resolved.source,
  });

  if (error || data?.ok === false) {
    console.error('unsubscribe failed', error || data);
    if (wantsHtml) {
      return htmlPage('Unsubscribe', 'We could not save your request. Please try again later.', 'en');
    }
    return new Response(JSON.stringify({ ok: false, error: 'save_failed' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!wantsHtml || req.method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  return htmlPage(
    'Unsubscribed',
    'You will no longer receive ATHAR alert emails at this address. Password reset and login codes are not affected.',
    'en',
  );
});
