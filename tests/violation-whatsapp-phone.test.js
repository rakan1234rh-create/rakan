/**
 * Static guard: WhatsApp Click to Chat after violation.
 * Official FAQ: https://wa.me/<number>?text=urlencodedtext
 * https://faq.whatsapp.com/5913398998672934
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
assert(app.includes('clickWhatsAppClickToChatLink'), 'uses FAQ-style <a> Click to Chat');
assert(app.includes('isSeparateBrowserWindow'), 'guards against same-tab open');

// Official FAQ format — prefer wa.me, not api.whatsapp.com
assert(
  app.includes('https://wa.me/${digits}?text=${encodeURIComponent(text)}') ||
    /return `https:\/\/wa\.me\/\$\{digits\}\?text=\$\{encodeURIComponent\(text\)\}`/.test(app),
  'compose URL must be https://wa.me/<digits>?text=urlencoded'
);
assert(!app.includes('api.whatsapp.com/send'), 'must not use api.whatsapp.com/send');
assert(
  !app.includes('جاري التحضير لفتح واتساب'),
  'must not inject custom Arabic prep HTML into about:blank'
);

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
  openFn.includes('placeholderWin.location.href = url') ||
    openFn.includes('opts.placeholderWin.location.href = url'),
  'placeholder tab may navigate to wa.me'
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

assert(
  fs.existsSync(path.join(root, 'supabase/functions/violation-push/index.ts')),
  'violation-push function present'
);

console.log('violation-whatsapp-phone.test.js: ok');
