/**
 * Sync send-auth-emails embedded Base64 templates from athar-recovery-simple.html
 * Run: node scripts/sync-auth-email-templates.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const simplePath = join(root, 'supabase/email-templates/athar-recovery-simple.html');
const edgePath = join(root, 'supabase/functions/send-auth-emails/index.ts');

const html = readFileSync(simplePath, 'utf8');
if (/UNSUBSCRIBE_URL|href\s*=\s*["']#["']/i.test(html)) {
  console.error('athar-recovery-simple.html still contains unsubscribe placeholders — refuse to sync');
  process.exit(1);
}

const subject = 'استعادة كلمة المرور — ATHAR';
const text = [
  'مرحبا،',
  '',
  'تلقينا طلبا لاعادة تعيين كلمة المرور لحسابك في منصة اثر.',
  '',
  'رمز التحقق: {{TOKEN}}',
  '',
  'ادخل الرمز في صفحة استعادة كلمة المرور داخل المنصة.',
  'اذا لم تطلب ذلك، تجاهل هذه الرسالة.',
  'الرمز صالح لمرة واحدة ولمدة محدودة.',
  '',
  'ATHAR · athar-app.online',
].join('\n');

const htmlB64 = Buffer.from(html, 'utf8').toString('base64');
const subjectB64 = Buffer.from(subject, 'utf8').toString('base64');
const textB64 = Buffer.from(text, 'utf8').toString('base64');

let edge = readFileSync(edgePath, 'utf8');
edge = edge.replace(/const HTML_B64 = '[^']*';/, `const HTML_B64 = '${htmlB64}';`);
edge = edge.replace(/const SUBJECT_B64 = '[^']*';/, `const SUBJECT_B64 = '${subjectB64}';`);
edge = edge.replace(/const TEXT_B64 = '[^']*';/, `const TEXT_B64 = '${textB64}';`);

if (!edge.includes(`const HTML_B64 = '${htmlB64}'`)) {
  console.error('Failed to replace HTML_B64');
  process.exit(1);
}

writeFileSync(edgePath, edge);
console.log('Synced HTML_B64 / SUBJECT_B64 / TEXT_B64 into send-auth-emails/index.ts');
console.log('HTML bytes:', Buffer.byteLength(html, 'utf8'), 'no unsubscribe placeholders');
