/** Signed unsubscribe tokens — no raw email in public links. */

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function unsubscribeSigningSecret(): string {
  return (
    Deno.env.get('UNSUBSCRIBE_SIGNING_SECRET')
    || Deno.env.get('R2_STREAM_HMAC_SECRET')
    || Deno.env.get('SEND_EMAIL_HOOK_SECRET')
    || ''
  ).trim();
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export type UnsubClaims = {
  email: string;
  channel: string;
  exp: number;
};

/** Create a compact signed token: payload.b64url.sig.b64url */
export async function createUnsubscribeToken(
  email: string,
  channel = 'alerts',
  ttlSeconds = 60 * 60 * 24 * 400,
): Promise<string> {
  const secret = unsubscribeSigningSecret();
  if (!secret) throw new Error('UNSUBSCRIBE_SIGNING_SECRET (or R2_STREAM_HMAC_SECRET) is not set');
  const normalized = String(email || '').trim().toLowerCase();
  const ch = channel === 'digest' || channel === 'all' ? channel : 'alerts';
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(enc.encode(JSON.stringify({ e: normalized, c: ch, exp })));
  const sig = b64url(await hmacSha256(secret, payload));
  return `${payload}.${sig}`;
}

export async function verifyUnsubscribeToken(token: string): Promise<UnsubClaims | null> {
  const secret = unsubscribeSigningSecret();
  if (!secret) return null;
  const raw = String(token || '').trim();
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  if (!payload || !sigB64) return null;
  try {
    const expected = await hmacSha256(secret, payload);
    const got = b64urlToBytes(sigB64);
    if (!timingSafeEqual(expected, got)) return null;
    const json = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as {
      e?: string;
      c?: string;
      exp?: number;
    };
    const email = String(json.e || '').trim().toLowerCase();
    const channel = json.c === 'digest' || json.c === 'all' ? json.c : 'alerts';
    const exp = Number(json.exp || 0);
    if (!email || !email.includes('@') || !exp) return null;
    if (exp < Math.floor(Date.now() / 1000)) return null;
    return { email, channel, exp };
  } catch {
    return null;
  }
}

export function isAppleMailbox(email: string): boolean {
  const domain = String(email || '').split('@').pop()?.toLowerCase() || '';
  return domain === 'icloud.com' || domain === 'me.com' || domain === 'mac.com';
}

export function buildUnsubscribeUrls(token: string, channel: string): {
  pageUrl: string;
  apiUrl: string;
} {
  const origin = (Deno.env.get('ATHAR_PUBLIC_ORIGIN') || 'https://athar-app.online').replace(/\/$/, '');
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const anon = (
    Deno.env.get('SUPABASE_ANON_KEY')
    || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    || ''
  ).trim();
  const q = new URLSearchParams({ t: token });
  if (channel && channel !== 'alerts') q.set('channel', channel);
  if (anon) q.set('apikey', anon);
  return {
    // English path + token only — avoids Apple Mail gluing Arabic link text into the URL.
    pageUrl: `${origin}/unsubscribe.html?t=${encodeURIComponent(token)}`,
    apiUrl: `${base}/functions/v1/email-unsubscribe?${q.toString()}`,
  };
}
