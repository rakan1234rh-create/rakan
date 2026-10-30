/**
 * WhatsApp Click to Chat after violation — persistent in-app wa.me link.
 * FAQ: https://wa.me/<number>?text=urlencodedtext
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
assert(app.includes('showViolationWhatsAppBar'), 'shows persistent in-app wa.me bar');
assert(app.includes("bar.id = 'violationWaBar'") || app.includes('violationWaBar'), 'bar id present');
assert(!app.includes('promptOpenViolationWhatsApp'), 'confirmDialog prompt path removed');
assert(!app.includes("window.open('about:blank'"), 'must not open about:blank');
assert(!app.includes('api.whatsapp.com/send'), 'must not use api.whatsapp.com/send');
assert(
  /return `https:\/\/wa\.me\/\$\{digits\}\?text=\$\{encodeURIComponent\(text\)\}`/.test(app),
  'compose URL must be https://wa.me/<digits>?text=urlencoded'
);

const submitSlice = app.slice(
  app.indexOf('async function submitNewTicket'),
  app.indexOf('// ═══════════════════════════════════════════════════════════════════════════\n      // 19. FILE UPLOADS')
);
assert(submitSlice.includes('await openWhatsAppAfterViolation'), 'submit awaits WhatsApp offer');
assert(
  submitSlice.includes('employeeId: emp.id'),
  'passes employeeId so phone RPC can run if cache empty'
);
// Must not gate the call on empPhone alone (silent skip when RPC needed)
assert(
  !/if\s*\(\s*empPhone\s*\)\s*\{\s*await openWhatsAppAfterViolation/.test(submitSlice) &&
    !/if\s*\(\s*phoneForWa/.test(submitSlice),
  'must always call openWhatsAppAfterViolation after success (toast if no phone)'
);

const phoneFnMatch = app.match(
  /function phoneToWhatsAppDigits\(phone\) \{[\s\S]*?\n      \}/
);
assert(phoneFnMatch, 'found phoneToWhatsAppDigits');
const sandbox = {
  Sec: {
    normalizePhone(s) {
      if (s == null || s === '') return '';
      let digits = String(s).trim().replace(/\D/g, '');
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
assert(sandbox.phoneToWhatsAppDigits('+966501234567') === '966501234567', '+966…');
assert(sandbox.phoneToWhatsAppDigits('00966501234567') === '966501234567', '00966…');

assert(
  fs.existsSync(path.join(root, 'supabase/functions/violation-push/index.ts')),
  'violation-push present'
);

console.log('violation-whatsapp-phone.test.js: ok');
