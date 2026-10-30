/**
 * Static guard: WhatsApp after violation must resolve phone without putting
 * phone back into get_user_directory (PII), keep classic api.whatsapp.com
 * compose page, and must not blank the SPA/PWA.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261030163000_get_violation_subject_phone.sql'),
  'utf8'
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(migration.includes('get_violation_subject_phone'), 'migration defines RPC');
assert(
  migration.includes("ARRAY['admin', 'manager', 'observer', 'supervisor']"),
  'RPC limited to violation insert roles'
);
assert(
  migration.includes("u.role IN ('employee'::public.user_role, 'branch_manager'::public.user_role)"),
  'RPC limited to violation subjects'
);
assert(app.includes("sb.rpc('get_violation_subject_phone'"), 'app calls phone RPC');
assert(app.includes('fetchViolationSubjectPhone'), 'app defines phone helper');
assert(app.includes('buildViolationWhatsAppUrl'), 'keeps WhatsApp compose URL builder');
assert(app.includes('openWhatsAppAfterViolation'), 'keeps open-WhatsApp after insert');
assert(app.includes('armWhatsAppPlaceholderWindow'), 'arms separate placeholder only');
assert(app.includes('isSeparateBrowserWindow'), 'guards against same-tab open');
assert(app.includes('promptOpenViolationWhatsApp'), 'offers gesture re-prompt when blocked');
assert(app.includes('openWhatsAppUrlInNewContext'), 'opens WhatsApp outside current tab');

// Classic click-to-chat landing (message prefilled + Continue / Open WhatsApp).
assert(
  app.includes('https://api.whatsapp.com/send?phone='),
  'compose URL must use api.whatsapp.com/send intermediate page'
);
assert(
  !app.includes('جاري التحضير لفتح واتساب'),
  'must not inject custom Arabic prep HTML into about:blank'
);

// Must never navigate the Athar tab to WhatsApp (white flash → back).
const openFn = app.slice(
  app.indexOf('function openWhatsAppAfterViolation'),
  app.indexOf('async function submitNewTicket')
);
assert(openFn.includes('function openWhatsAppAfterViolation'), 'found openWhatsAppAfterViolation');
assert(
  !/window\.location\.href\s*=\s*url/.test(openFn),
  'openWhatsAppAfterViolation must not set window.location.href = url on Athar'
);
assert(
  !/window\.location\.assign\s*\(\s*url\s*\)/.test(openFn),
  'openWhatsAppAfterViolation must not location.assign(url) on Athar'
);
// Placeholder tab may navigate: placeholderWin.location.href = url
assert(
  openFn.includes('placeholderWin.location.href = url') ||
    openFn.includes('opts.placeholderWin.location.href = url'),
  'placeholder tab should navigate to WhatsApp compose URL'
);

assert(
  !/get_user_directory[\s\S]{0,800}\bphone\b/.test(
    fs.readFileSync(
      path.join(root, 'supabase/migrations/20261017162500_include_referenced_inactive_users_in_directory.sql'),
      'utf8'
    )
  ),
  'directory migration still omits phone'
);

const pushPath = path.join(root, 'supabase/functions/violation-push/index.ts');
assert(fs.existsSync(pushPath), 'violation-push function present');

console.log('violation-whatsapp-phone.test.js: ok');
