/**
 * Static guard: WhatsApp after violation must resolve phone without putting
 * phone back into get_user_directory (PII).
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
assert(app.includes('buildViolationWhatsAppUrl'), 'keeps wa.me compose path');
assert(app.includes('openWhatsAppAfterViolation'), 'keeps open-WhatsApp after insert');
assert(
  !/get_user_directory[\s\S]{0,800}\bphone\b/.test(
    fs.readFileSync(
      path.join(root, 'supabase/migrations/20261017162500_include_referenced_inactive_users_in_directory.sql'),
      'utf8'
    )
  ),
  'directory migration still omits phone'
);

console.log('violation-whatsapp-phone.test.js: ok');
