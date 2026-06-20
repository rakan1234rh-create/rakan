/**
 * يبني قوالب بريد الاستعادة من icons/athar-wordmark-email-v388.png
 * تشغيل: node scripts/build-email-recovery-template.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64 = readFileSync(join(root, 'icons/athar-wordmark-email-v388.png')).toString('base64');
const LOGO = `data:image/png;base64,${b64}`;

const copyIcon = `<span role="button" tabindex="0" title="نسخ الرمز" onmousedown="this.style.opacity='0.55';this.style.transform='scale(0.92)';" onmouseup="this.style.opacity='1';this.style.transform='scale(1)';" onmouseleave="this.style.opacity='1';this.style.transform='scale(1)';" ontouchstart="this.style.opacity='0.55';" ontouchend="this.style.opacity='1';" onclick="var b=this;function done(){b.style.color='#16a34a';setTimeout(function(){b.style.color='#52525b';},1600);}if(navigator.clipboard&amp;&amp;navigator.clipboard.writeText){navigator.clipboard.writeText('{{ .Token }}').then(done).catch(done);}else{done();}" style="display:inline-block;cursor:pointer;padding:10px 8px;color:#52525b;line-height:0;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></span>`;

function buildSimple() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    :root { color-scheme: light only; supported-color-schemes: light; }
    body, table, td, p, div, span { color-scheme: light only; }
    .athar-outer { background-color: #f5f5f5 !important; background-image: linear-gradient(#f5f5f5, #f5f5f5) !important; }
    .athar-card { background-color: #ffffff !important; background-image: linear-gradient(#ffffff, #ffffff) !important; }
    .athar-token { background-color: #fafafa !important; background-image: linear-gradient(#fafafa, #fafafa) !important; color: #18181b !important; }
    .athar-title { color: #18181b !important; }
    .athar-body { color: #3f3f46 !important; }
    .athar-muted { color: #71717a !important; }
    @media (prefers-color-scheme: dark) {
      .athar-outer { background-color: #f5f5f5 !important; background-image: linear-gradient(#f5f5f5, #f5f5f5) !important; }
      .athar-card { background-color: #ffffff !important; background-image: linear-gradient(#ffffff, #ffffff) !important; }
      .athar-token { background-color: #fafafa !important; background-image: linear-gradient(#fafafa, #fafafa) !important; color: #18181b !important; }
      .athar-title { color: #18181b !important; }
      .athar-body { color: #3f3f46 !important; }
      .athar-muted { color: #71717a !important; }
    }
    u + .body .athar-outer { background-color: #f5f5f5 !important; background-image: linear-gradient(#f5f5f5, #f5f5f5) !important; }
    u + .body .athar-card { background-color: #ffffff !important; background-image: linear-gradient(#ffffff, #ffffff) !important; }
    u + .body .athar-token { background-color: #fafafa !important; background-image: linear-gradient(#fafafa, #fafafa) !important; color: #18181b !important; }
    u + .body .athar-title { color: #18181b !important; }
    u + .body .athar-body { color: #3f3f46 !important; }
    u + .body .athar-muted { color: #71717a !important; }
    [data-ogsc] .athar-outer { background-color: #f5f5f5 !important; }
    [data-ogsc] .athar-card { background-color: #ffffff !important; }
    [data-ogsc] .athar-title { color: #18181b !important; }
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
          <td align="center" class="athar-card" bgcolor="#ffffff" style="padding:32px 28px 16px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
            <img src="${LOGO}" width="240" height="148" alt="ATHAR" style="display:block;width:240px;max-width:100%;height:auto;border:0;margin:0 auto;">
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
                <td style="padding-right:4px;vertical-align:middle;">
                  ${copyIcon}
                </td>
              </tr>
            </table>
            <p class="athar-muted" style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#71717a;text-align:center;">اكتب هذا الرمز في صفحة استعادة كلمة المرور داخل المنصة.</p>
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

const simple = buildSimple();
writeFileSync(join(root, 'supabase/email-templates/athar-recovery-simple.html'), simple);

const full = simple
  .replace(
    'style="display:block;width:240px;max-width:100%;height:auto;border:0;margin:0 auto;">',
    'style="display:block;width:240px;max-width:100%;height:auto;border:0;margin:0 auto 8px;">\n            <div class="athar-muted" style="font-size:13px;color:#71717a;margin-top:8px;">منصة الرصد المتكاملة</div>'
  )
  .replace('من 8 خانات</p>', 'من 8 خانات:</p>')
  .replace(
    '<p class="athar-muted" style="margin:0 0 12px;font-size:13px;line-height:1.65;color:#71717a;">إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>',
    `<p style="margin:0 0 24px;text-align:center;">
              <a href="{{ .ConfirmationURL }}" style="display:inline-block;color:#18181b;text-decoration:underline;font-size:13px;">فتح رابط احتياطي لإعادة التعيين</a>
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

writeFileSync(join(root, 'supabase/email-templates/athar-recovery.html'), full);
console.log('Built email templates from athar-wordmark-email-v388.png');
