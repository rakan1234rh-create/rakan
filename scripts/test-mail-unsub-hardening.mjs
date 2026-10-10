/**
 * Local hardening checks — fake emails only, no SMTP send, no prod writes.
 * Run: node scripts/test-mail-unsub-hardening.mjs
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('OK  :', msg);
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function createToken(email, channel, secret, ttl = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = b64url(Buffer.from(JSON.stringify({
    e: String(email).trim().toLowerCase(),
    c: channel === 'digest' || channel === 'all' ? channel : 'alerts',
    exp,
  }), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!json.e || json.exp < Math.floor(Date.now() / 1000)) return null;
  return { email: json.e, channel: json.c || 'alerts', exp: json.exp };
}

function buildPageUrl(token, origin = 'https://athar-app.online') {
  return `${origin.replace(/\/$/, '')}/unsubscribe.html?t=${encodeURIComponent(token)}`;
}

// --- Recovery template source ---
const simple = readFileSync(join(root, 'supabase/email-templates/athar-recovery-simple.html'), 'utf8');
assert(!/UNSUBSCRIBE_URL/i.test(simple), 'athar-recovery-simple.html has no UNSUBSCRIBE_URL');
assert(!/href\s*=\s*["']#["']/i.test(simple), 'athar-recovery-simple.html has no dead href="#"');
assert(!/List-Unsubscribe/i.test(simple), 'athar-recovery-simple.html has no List-Unsubscribe');
assert(!/settings\?unsubscribe=/i.test(simple), 'athar-recovery-simple.html has no settings?unsubscribe=');

// --- Embedded Base64 in send-auth-emails ---
const edge = readFileSync(join(root, 'supabase/functions/send-auth-emails/index.ts'), 'utf8');
const htmlB64 = edge.match(/const HTML_B64 = '([^']+)'/)?.[1];
const textB64 = edge.match(/const TEXT_B64 = '([^']+)'/)?.[1];
assert(Boolean(htmlB64 && textB64), 'HTML_B64 and TEXT_B64 present');
const html = Buffer.from(htmlB64, 'base64').toString('utf8');
const text = Buffer.from(textB64, 'base64').toString('utf8');
assert(!/UNSUBSCRIBE/i.test(html + text), 'embedded recovery template has no unsubscribe markers');
assert(!/href\s*=\s*["']#["']/i.test(html), 'embedded HTML has no href="#"');
assert(!/settings\?unsubscribe=/i.test(html + text), 'embedded recovery has no settings?unsubscribe=');
assert(!/List-Unsubscribe/i.test(html + text), 'embedded recovery body has no List-Unsubscribe text');
assert(/athar-app\.online/i.test(html), 'embedded HTML mentions athar-app.online as brand text');
assert(!/vms-v2\.aromaticfamilies\.com/i.test(html + text), 'embedded recovery has no vms-v2 domain');

// Simulate buildRecoveryEmail + headers for fake recipients
const fakeToken = '123456';
const builtHtml = html.replaceAll('{{TOKEN}}', fakeToken);
const builtText = text.replaceAll('{{TOKEN}}', fakeToken);
assert(!/@fake-user\.example/i.test(builtHtml + builtText), 'recovery body does not embed recipient email');
assert(!/https?:\/\/[^\s"']*@/i.test(builtHtml + builtText), 'recovery has no URL containing @ (email leakage)');

const headerFn = edge.match(/function emailHeaders[\s\S]*?\n\}/)?.[0] || '';
assert(/X-Entity-Ref-ID/.test(headerFn), 'emailHeaders keeps X-Entity-Ref-ID');
assert(
  !/['"]List-Unsubscribe['"]\s*:/.test(headerFn),
  'emailHeaders does not set List-Unsubscribe',
);
assert(
  !/['"]List-Unsubscribe-Post['"]\s*:/.test(headerFn),
  'emailHeaders does not set List-Unsubscribe-Post',
);

const appleFn = edge.match(/function buildAppleRecoveryEmail[\s\S]*?\n\}/)?.[0] || '';
assert(!/https:\/\//i.test(appleFn), 'Apple recovery builder has no https:// URLs');
assert(!/athar-app\.online/i.test(appleFn), 'Apple recovery builder has no athar-app.online web link');
assert(!/vms-v2/i.test(appleFn), 'Apple recovery builder has no vms-v2 domain');
assert(!/List-Unsubscribe/i.test(appleFn), 'Apple recovery builder has no List-Unsubscribe');
assert(!/\$\{_?to\}|الى:\s*\$\{/.test(appleFn), 'Apple recovery does not put recipient in body');

// --- Origin defaults ---
const appJs = readFileSync(join(root, 'js/app.js'), 'utf8');
assert(
  /const ATHAR_PUBLIC_ORIGIN = 'https:\/\/athar-app\.online'/.test(appJs),
  'js/app.js ATHAR_PUBLIC_ORIGIN defaults to https://athar-app.online',
);
assert(
  !/const ATHAR_PUBLIC_ORIGIN = 'https:\/\/vms-v2\.aromaticfamilies\.com'/.test(appJs),
  'js/app.js no longer defaults ATHAR_PUBLIC_ORIGIN to vms-v2',
);
assert(
  /Signed tokens only/.test(appJs) || /raw \?unsubscribe=email is rejected/.test(appJs),
  'app.js rejects legacy raw-email unsubscribe path',
);

const cname = readFileSync(join(root, 'CNAME'), 'utf8').trim();
assert(cname === 'athar-app.online', `CNAME is athar-app.online (got ${cname})`);

const unsubPage = readFileSync(join(root, 'unsubscribe.html'), 'utf8');
assert(existsSync(join(root, 'unsubscribe.html')), 'unsubscribe.html exists in repo root');
assert(/email-unsubscribe/.test(unsubPage), 'unsubscribe.html posts to email-unsubscribe');
assert(/JSON\.stringify\(\{\s*t:\s*token/.test(unsubPage), 'unsubscribe.html sends signed t= token');
assert(!/email:\s*/.test(unsubPage.replace(/[\s\S]*?<script>/, '')), 'unsubscribe.html script does not send raw email field');

const deployPages = readFileSync(join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
assert(/cp unsubscribe\.html/.test(deployPages), 'deploy-pages copies unsubscribe.html into site root');
assert(/cp.*CNAME/.test(deployPages), 'deploy-pages copies CNAME into site root');

const tokenShared = readFileSync(join(root, 'supabase/functions/_shared/unsubscribe-token.ts'), 'utf8');
assert(
  /ATHAR_PUBLIC_ORIGIN'\)\s*\|\|\s*'https:\/\/athar-app\.online'/.test(tokenShared),
  'unsubscribe-token default origin is https://athar-app.online',
);
assert(/unsubscribe\.html\?t=/.test(tokenShared), 'pageUrl uses /unsubscribe.html?t=');

// --- Signed token URL checks (fake emails) ---
const secret = 'test-unsub-secret-not-for-prod';
const fake = 'fake.user+alerts@example.test';
const tok = createToken(fake, 'alerts', secret);
const claims = verifyToken(tok, secret);
assert(claims?.email === fake, 'signed token verifies to fake email');
const pageUrl = buildPageUrl(tok);
assert(pageUrl.startsWith('https://athar-app.online/unsubscribe.html?t='), 'unsub page URL uses athar-app.online');
assert(!pageUrl.includes(fake), 'unsub page URL does not contain raw email');
assert(!pageUrl.includes(encodeURIComponent(fake)), 'unsub page URL does not contain encoded email');
assert(!/vms-v2/.test(pageUrl), 'unsub page URL has no vms-v2');

const bad = verifyToken('not-a-token', secret);
assert(bad === null, 'unsigned garbage token fails verify');
const forged = createToken('victim@example.test', 'alerts', 'wrong-secret');
assert(verifyToken(forged, secret) === null, 'token signed with wrong secret fails verify');

// --- email-unsubscribe rejects unsigned (source contract) ---
const unsubFn = readFileSync(join(root, 'supabase/functions/email-unsubscribe/index.ts'), 'utf8');
assert(/missing_token|invalid_token/.test(unsubFn), 'email-unsubscribe handles missing/invalid token');
assert(!/p_email:\s*normalizeEmail\(.*email/.test(unsubFn), 'email-unsubscribe no longer records from raw email param');
assert(/verifyUnsubscribeToken/.test(unsubFn), 'email-unsubscribe requires verifyUnsubscribeToken');
assert(
  /athar_record_email_unsubscribe/.test(unsubFn)
  && unsubFn.indexOf('invalid_token') < unsubFn.indexOf('athar_record_email_unsubscribe'),
  'RPC only after successful token verify path',
);

// --- Alert / digest: Apple mailto without One-Click Post ---
const vp = readFileSync(join(root, 'supabase/functions/violation-push/index.ts'), 'utf8');
const digest = readFileSync(join(root, 'supabase/functions/violation-push/violation-weekly-digest.ts'), 'utf8');
assert(/buildUnsubscribeUrls/.test(vp) && /createUnsubscribeToken/.test(vp), 'violation-push uses signed tokens');
assert(/buildUnsubscribeUrls/.test(digest), 'digest uses signed tokens');
assert(
  /List-Unsubscribe': `<\$\{mailtoUnsub\}>`/.test(vp)
  || /'List-Unsubscribe': `<\$\{mailtoUnsub\}>`/.test(vp),
  'Apple alert path uses mailto List-Unsubscribe',
);
assert(
  /apple[\s\S]{0,200}List-Unsubscribe-Post/.test(vp) === false
  || /apple\s*\?\s*\{\s*'List-Unsubscribe':\s*`<\$\{mailtoUnsub\}>`\s*\}/.test(vp),
  'Apple alert headers omit List-Unsubscribe-Post (mailto-only)',
);
assert(!/settings\?unsubscribe=/.test(vp + digest), 'alert/digest bodies have no settings?unsubscribe=');

const deployFn = readFileSync(join(root, '.github/workflows/deploy-violation-push.yml'), 'utf8');
assert(/supabase\/functions\/_shared\/\*\*/.test(deployFn), 'deploy workflow watches _shared');
assert(/SUPABASE_ACCESS_TOKEN/.test(deployFn), 'deploy workflow references SUPABASE_ACCESS_TOKEN secret name only');

console.log('');
if (failed) {
  console.error(`DONE with ${failed} failure(s)`);
  process.exit(1);
}
console.log('DONE: all local hardening checks passed (no mail sent, no prod changes)');
