#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function expect(condition, label) {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function validateSqlPath(input) {
  try {
    return {
      ok: true,
      output: execFileSync('bash', [
        'scripts/validate-sql-migration-path.sh',
        root,
        input,
      ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
    };
  } catch (error) {
    return { ok: false, output: String(error.stderr || '').trim() };
  }
}

const pages = read('.github/workflows/deploy-pages.yml');
expect(!/\bref:\s*staging\b/i.test(pages), 'Pages workflow لا يعمل checkout لفرع staging');
expect(!/\bstaging-src\b/i.test(pages), 'Pages workflow لا ينشئ staging-src');
expect(!/build_site\s+"\$GITHUB_WORKSPACE\/staging-src"/i.test(pages), 'artifact الإنتاج لا يبنى من مصدر staging');
expect(/test ! -e site\/staging/.test(pages), 'workflow يتحقق أن artifact لا يحتوي /staging');
expect(/build:\s*\n\s*#.*\n\s*if: github\.ref == 'refs\/heads\/main'/.test(pages), 'بناء Pages مقصور على main');
expect(/deploy:\s*\n\s*needs: build\s*\n\s*if: github\.ref == 'refs\/heads\/main'/.test(pages), 'نشر Pages مقصور على main');
expect(/persist-credentials: false/.test(pages), 'checkout Pages لا يحتفظ ببيانات GitHub');
expect(/vars\.ATHAR_SECURITY_BACKEND_READY/.test(pages) && /\[ "\$BACKEND_READY" != "true" \]/.test(pages), 'نشر الواجهة يفشل مغلقاً حتى تجهيز الخلفية');

const sqlWorkflow = read('.github/workflows/apply-sql-fixes.yml');
expect(/apply:\s*\n\s*#.*\n\s*if: github\.ref == 'refs\/heads\/main'/.test(sqlWorkflow), 'تنفيذ SQL مقصور على main');
expect(/ref: main/.test(sqlWorkflow) && /persist-credentials: false/.test(sqlWorkflow), 'SQL checkout يثبت main بلا بيانات git دائمة');
expect(/bash scripts\/validate-sql-migration-path\.sh/.test(sqlWorkflow), 'SQL workflow يستعمل مدقق المسار المركزي');

const validMigration = 'migrations/20261009120000_harden_append_violation_log_auth.sql';
const valid = validateSqlPath(validMigration);
expect(valid.ok, 'مسار migration قانوني يمر من المدقق');
expect(valid.output === join(root, 'supabase', validMigration), 'المدقق يعيد canonical path المتوقع');
for (const input of [
  'migrations/../weekly_digest_cron.sql',
  `migrations//${validMigration.split('/').at(-1)}`,
  'migrations/20261009120000_harden_append_violation_log_auth.sql/../../weekly_digest_cron.sql',
  '/etc/passwd',
  'migrations/not-a-real-migration.sql',
]) {
  expect(!validateSqlPath(input).ok, `يرفض المدقق الإدخال الخطر أو غير الموجود: ${input}`);
}

const edgeWorkflow = read('.github/workflows/deploy-violation-push.yml');
for (const fn of ['password-recovery', 'employee-login']) {
  expect(new RegExp(`supabase/functions/${fn}/\\*\\*`).test(edgeWorkflow), `trigger النشر يراقب ${fn}`);
  expect(new RegExp(`functions deploy ${fn} --no-verify-jwt`).test(edgeWorkflow), `${fn} يبقى endpoint bootstrap مع تحقق داخلي`);
}
expect(/functions deploy admin-users --project-ref/.test(edgeWorkflow), 'admin-users يحافظ على تحقق JWT في البوابة');
expect(!/functions deploy admin-users --no-verify-jwt/.test(edgeWorkflow), 'لا يوجد no-verify-jwt غير لازم لـ admin-users');
expect(/deploy:\s*\n\s*#.*\n\s*if: github\.ref == 'refs\/heads\/main'/.test(edgeWorkflow), 'نشر Edge مقصور على main');
expect(/Verify all Edge function sources are present/.test(edgeWorkflow), 'workflow يمنع النشر الجزئي عندما يغيب مصدر Edge');
expect(/vars\.ATHAR_SECURITY_EDGE_RELEASE_APPROVED/.test(edgeWorkflow) && /\[ "\$RELEASE_APPROVED" != "true" \]/.test(edgeWorkflow), 'دمج PR وحده لا ينشر Edge قبل اعتماد الإصدار');
for (const fn of ['password-recovery', 'employee-login']) {
  expect(edgeWorkflow.includes('supabase/functions/${fn}/index.ts') && edgeWorkflow.includes(fn), `preflight يتحقق من مصدر ${fn}`);
}

const adminUsers = read('supabase/functions/admin-users/index.ts');
expect(/auth\.getUser\(jwt\)/.test(adminUsers), 'admin-users يتحقق من JWT داخل المعالج');
expect(/select\('id, role, is_active'\)/.test(adminUsers), 'admin-users يجلب حالة الحساب والدور فقط للتحقق');
expect(/if \(!profile\.is_active\)/.test(adminUsers), 'admin-users يرفض المستخدم غير النشط');
expect(/callerCanManageUsers/.test(adminUsers), 'admin-users يفرض صلاحية الدور manage_users');

const r2Storage = read('supabase/functions/r2-storage/index.ts');
expect(/auth\.getUser\(\)/.test(r2Storage), 'r2-storage يتحقق من JWT داخلياً عندما لا يكون الطلب خدمة موثوقة');
expect(/isServiceRoleRequest/.test(r2Storage), 'r2-storage يفصل مسار service role الموثوق');

const push = read('supabase/functions/violation-push/index.ts');
expect(/isAuthorizedCron/.test(push), 'violation-push يتحقق من سر cron');
expect(/resolveAdminFromJwt/.test(push), 'violation-push يتحقق من JWT والدور لمسار broadcast');
expect(/if \(u\.is_active === false\) continue;/.test(push), 'violation-push يستبعد المستلمين غير النشطين');

const sw = read('sw.js');
expect(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'Service Worker لا يعترض fetch ولا يعيد محتوى staging من cache');
expect(!/\bcaches\s*\./.test(sw) && !/CacheStorage/.test(sw), 'Service Worker لا يستخدم Cache Storage');

if (failures) {
  console.error(`\n${failures} اختبار/اختبارات فشل.`);
  process.exit(1);
}
console.log('\nكل اختبارات أمن النشر نجحت.');
