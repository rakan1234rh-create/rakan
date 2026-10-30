/**
 * Static guard: violation emails must use durable claim idempotency.
 * Future-only — no historical backfill/resend helpers.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const edge = fs.readFileSync(
  path.join(root, 'supabase/functions/violation-push/index.ts'),
  'utf8'
);
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261030170000_violation_email_delivery_idempotency.sql'),
  'utf8'
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(migration.includes('violation_email_deliveries'), 'migration creates delivery ledger');
assert(migration.includes('athar_claim_violation_email'), 'migration defines claim RPC');
assert(migration.includes('athar_complete_violation_email'), 'migration defines complete RPC');
assert(
  !/INSERT INTO public\.violation_email_deliveries[\s\S]*SELECT[\s\S]*FROM public\.violations/i.test(migration),
  'migration must not backfill old violation emails'
);

assert(edge.includes('athar_claim_violation_email'), 'edge claims before SMTP');
assert(edge.includes('athar_complete_violation_email'), 'edge completes after SMTP');
assert(edge.includes('skipped_duplicate'), 'edge skips duplicate claims');
assert(edge.includes('2026-10-email-idempotency-v6'), 'version marker bumped');
assert(
  /sendImmediateEmail\([\s\S]*?eventKey/.test(edge),
  'sendImmediateEmail receives eventKey for claim'
);

assert(
  /function notifyViolationPushAfterInsert\(violationRow\) \{[\s\S]*?invokeViolationPush\(\{\s*notify:\s*true/.test(app),
  'client keeps insert fallback notify'
);
assert(app.includes('Durable email claim prevents Hostinger duplicates'), 'documents dual-path claim');
assert(app.includes('openWhatsAppAfterViolation'), 'WhatsApp path kept');
assert(app.includes('notifyViolationPushAfterStateChange'), 'state-change notify kept');

console.log('violation-email-idempotency.test.js: ok');
