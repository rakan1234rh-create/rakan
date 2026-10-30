/**
 * WhatsApp Click to Chat after violation.
 * FAQ: https://wa.me/<number>?text=urlencodedtext
 * No about:blank / auto-close white tab.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
assert(app.includes("sb.rpc('get_violation_subject_phone'"), 'app calls phone RPC');
assert(app.includes('fetchViolationSubjectPhone'), 'app defines phone helper');
assert(app.includes('buildViolationWhatsAppUrl'), 'keeps WhatsApp compose URL builder');
assert(app.includes('openWhatsAppAfterViolation'), 'keeps open-WhatsApp after insert');
assert(app.includes('clickWhatsAppClickToChatLink'), 'uses <a target=_blank> Click to Chat');
assert(app.includes('promptOpenViolationWhatsApp'), 'opens after fresh user gesture');

assert(
  /return `https:\/\/wa\.me\/\$\{digits\}\?text=\$\{encodeURIComponent\(text\)\}`/.test(app),
  'compose URL must be https://wa.me/<digits>?text=urlencoded'
);
assert(!app.includes('api.whatsapp.com/send'), 'must not use api.whatsapp.com/send');
assert(!app.includes("window.open('about:blank'"), 'must not open about:blank placeholder');
assert(!app.includes('جاري التحضير لفتح واتساب'), 'must not inject prep HTML');
assert(!app.includes('armWhatsAppPlaceholderWindow'), 'placeholder arming removed');
assert(!app.includes('closeWhatsAppPlaceholder'), 'must not auto-close WhatsApp windows');

const openFn = app.slice(
  app.indexOf('function openWhatsAppAfterViolation'),
  app.indexOf('async function submitNewTicket')
);
assert(
  !/window\.location\.href\s*=\s*url/.test(openFn),
  'must not navigate Athar tab via window.location.href = url'
);
assert(openFn.includes('promptOpenViolationWhatsApp'), 'after-violation uses gesture prompt');

// Saudi phone → 9665XXXXXXXX
const phoneFnMatch = app.match(
  /function phoneToWhatsAppDigits\(phone\) \{[\s\S]*?\n      \}/
);
assert(phoneFnMatch, 'found phoneToWhatsAppDigits');
const sandbox = {
  Sec: {
    normalizePhone(s) {
      if (s == null || s === '') return '';
      let t = String(s).trim();
      let digits = t.replace(/\D/g, '');
      if (!digits) return '';
      if (digits.startsWith('966') && digits.length >= 12) {
        digits = '0' + digits.slice(3, 12);
      } else if (/^5\d{8}$/.test(digits)) {
        digits = '0' + digits;
      }
      if (digits.startsWith('05') && digits.length > 10) digits = digits.slice(0, 10);
      return digits;
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(phoneFnMatch[0], sandbox);
assert(sandbox.phoneToWhatsAppDigits('0501234567') === '966501234567', '05… → 9665…');
assert(sandbox.phoneToWhatsAppDigits('501234567') === '966501234567', '5… → 9665…');
assert(sandbox.phoneToWhatsAppDigits('+966501234567') === '966501234567', '+966…');
assert(sandbox.phoneToWhatsAppDigits('00966501234567') === '966501234567', '00966…');
assert(sandbox.phoneToWhatsAppDigits('966501234567') === '966501234567', '966…');

assert(
  fs.existsSync(path.join(root, 'supabase/functions/violation-push/index.ts')),
  'violation-push present'
);

console.log('violation-whatsapp-phone.test.js: ok');
