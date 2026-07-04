/**
 * يبني قوالب بريد الاستعادة الخفيفة المتوافقة مع مزودي البريد.
 * تشغيل: node scripts/build-email-recovery-template.mjs
 *
 * القالب المعتمد للإرسال (send-auth-emails) هو athar-recovery-simple.html
 * ويحتوي شعار ATHAR المضمّن (PNG base64). لتوليد HTML_B64 للـ Edge Function:
 *   node -e "console.log(Buffer.from(require('fs').readFileSync('supabase/email-templates/athar-recovery-simple.html')).toString('base64'))"
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'supabase/email-templates');
const simplePath = join(outDir, 'athar-recovery-simple.html');

function buildPlain() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
</head>
<body style="font-family:Arial,Tahoma,sans-serif;font-size:16px;color:#222222;line-height:1.6;margin:20px;">
  <p>مرحباً،</p>
  <p>طلب استعادة كلمة المرور لحسابك في ATHAR.</p>
  <p>رمز التحقق: <strong dir="ltr">{{TOKEN}}</strong></p>
  <p>أدخل الرمز في صفحة استعادة كلمة المرور داخل المنصة.</p>
  <p>إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>
</body>
</html>
`;
}

function buildSimple() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <style>
    :root { color-scheme: light only; supported-color-schemes: light; }
    body, table, td, p, div, span, a { color-scheme: light only; }
    .athar-outer { background-color: #f5f5f5 !important; background-image: linear-gradient(#f5f5f5, #f5f5f5) !important; }
    .athar-card { background-color: #ffffff !important; background-image: linear-gradient(#ffffff, #ffffff) !important; }
    .athar-brand, .athar-title, .athar-link { color: #18181b !important; }
    .athar-body { color: #3f3f46 !important; }
    .athar-muted { color: #71717a !important; }
    .athar-token { background-color: #fafafa !important; background-image: linear-gradient(#fafafa, #fafafa) !important; color: #18181b !important; }
    @media (prefers-color-scheme: dark) {
      .athar-outer { background-color: #f5f5f5 !important; background-image: linear-gradient(#f5f5f5, #f5f5f5) !important; }
      .athar-card { background-color: #ffffff !important; background-image: linear-gradient(#ffffff, #ffffff) !important; }
      .athar-brand, .athar-title, .athar-link { color: #18181b !important; }
      .athar-body { color: #3f3f46 !important; }
      .athar-muted { color: #71717a !important; }
      .athar-token { background-color: #fafafa !important; color: #18181b !important; }
    }
    u + .body .athar-outer { background-color: #f5f5f5 !important; background-image: linear-gradient(#f5f5f5, #f5f5f5) !important; }
    u + .body .athar-card { background-color: #ffffff !important; background-image: linear-gradient(#ffffff, #ffffff) !important; }
    u + .body .athar-brand, u + .body .athar-title, u + .body .athar-link { color: #18181b !important; }
    u + .body .athar-body { color: #3f3f46 !important; }
    u + .body .athar-muted { color: #71717a !important; }
    u + .body .athar-token { background-color: #fafafa !important; color: #18181b !important; }
    [data-ogsc] .athar-outer { background-color: #f5f5f5 !important; }
    [data-ogsc] .athar-card { background-color: #ffffff !important; }
    [data-ogsc] .athar-brand, [data-ogsc] .athar-title, [data-ogsc] .athar-link { color: #18181b !important; }
    [data-ogsc] .athar-body { color: #3f3f46 !important; }
    [data-ogsc] .athar-muted { color: #71717a !important; }
    [data-ogsc] .athar-token { background-color: #fafafa !important; color: #18181b !important; }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background-color:#f5f5f5;">
<table role="presentation" class="athar-outer" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f5f5" style="background-color:#f5f5f5;background-image:linear-gradient(#f5f5f5,#f5f5f5);font-family:Segoe UI,Tahoma,Arial,sans-serif;">
  <tr>
    <td align="center" class="athar-outer" bgcolor="#f5f5f5" style="padding:40px 20px;background-color:#f5f5f5;background-image:linear-gradient(#f5f5f5,#f5f5f5);">
      <table role="presentation" class="athar-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="max-width:480px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border-radius:16px;border:1px solid #e4e4e7;">
        <tr>
          <td align="center" class="athar-card" bgcolor="#ffffff" style="padding:32px 28px 12px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
            <div class="athar-brand" style="font-size:28px;line-height:1;font-weight:800;letter-spacing:0.08em;color:#18181b;">ATHAR</div>
            <div class="athar-muted" style="font-size:13px;line-height:1.6;color:#71717a;margin-top:8px;">منصة الرصد المتكاملة</div>
          </td>
        </tr>
        <tr>
          <td dir="rtl" class="athar-card" bgcolor="#ffffff" style="padding:8px 28px 28px;text-align:right;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
            <p class="athar-title" style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#18181b;">مرحباً،</p>
            <p class="athar-body" style="margin:0 0 24px;font-size:15px;line-height:1.75;color:#3f3f46;">تلقّينا طلباً لإعادة تعيين كلمة المرور لحسابك.</p>
            <p class="athar-body" style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#3f3f46;text-align:center;">رمز التحقق الخاص بك من 8 خانات</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 24px;">
              <tr>
                <td dir="ltr" class="athar-token" bgcolor="#fafafa" style="font-size:34px;letter-spacing:0.25em;font-weight:800;color:#18181b;background-color:#fafafa;background-image:linear-gradient(#fafafa,#fafafa);border:1px solid #e4e4e7;border-radius:14px;padding:16px 18px;text-align:center;white-space:nowrap;">
                  {{ .Token }}
                </td>
              </tr>
            </table>
            <p class="athar-muted" style="margin:0 0 16px;font-size:13px;line-height:1.7;color:#71717a;text-align:center;">اكتب هذا الرمز في صفحة استعادة كلمة المرور داخل المنصة.</p>
            <p class="athar-muted" style="margin:0 0 20px;font-size:12px;line-height:1.7;color:#71717a;text-align:center;">إذا لم تظهر الرسالة في صندوق الوارد، تحقق من البريد غير الهام أو الرسائل الترويجية.</p>
            <p class="athar-muted" style="margin:0 0 12px;font-size:13px;line-height:1.65;color:#71717a;">إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>
            <p class="athar-muted" style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">الرمز صالح لمرة واحدة ولمدة محدودة.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

mkdirSync(outDir, { recursive: true });

const plain = buildPlain();
writeFileSync(join(outDir, 'athar-recovery-plain.html'), plain);

// athar-recovery-simple.html is hand-maintained (wordmark PNG). Do not overwrite.
const simple = readFileSync(simplePath, 'utf8');

const full = simple
  .replace('{{TOKEN}}', '{{ .Token }}')
  .replace('رمز التحقق الخاص بك</p>', 'رمز التحقق الخاص بك:</p>')
  .replace(
    '<p class="athar-muted" style="margin:0 0 12px;font-size:13px;line-height:1.65;color:#71717a;">إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>',
    `<p style="margin:0 0 24px;text-align:center;">
              <a class="athar-link" href="{{ .ConfirmationURL }}" style="display:inline-block;color:#18181b;text-decoration:underline;font-size:13px;">فتح رابط احتياطي لإعادة التعيين</a>
            </p>
            <p class="athar-muted" style="margin:0 0 12px;font-size:13px;line-height:1.65;color:#71717a;">إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>`
  )
  .replace(
    `        </tr>
      </table>
    </td>
  </tr>
</table>
</body>`,
    `        </tr>
        <tr>
          <td class="athar-card" bgcolor="#ffffff" style="padding:16px 28px 24px;border-top:1px solid #e4e4e7;text-align:center;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
            <p class="athar-muted" style="margin:0;font-size:11px;color:#71717a;">ATHAR — منصة الرصد المتكاملة</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>`
  );

writeFileSync(join(outDir, 'athar-recovery.html'), full);
console.log('Built lightweight password recovery email templates');
