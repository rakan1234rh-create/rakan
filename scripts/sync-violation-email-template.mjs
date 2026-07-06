import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = join(root, 'supabase/functions/violation-push/violation-email.html');
const outPath = join(root, 'supabase/functions/violation-push/violation-email-template.ts');
const html = readFileSync(htmlPath, 'utf8');

const out = `/** Auto-synced from violation-email.html */
export const VIOLATION_EMAIL_HTML = ${JSON.stringify(html)};
`;

writeFileSync(outPath, out);
console.log('Synced violation email template →', outPath);
