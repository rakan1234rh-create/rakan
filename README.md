# مرصاد — Mirsad Monitoring Platform

## Overview (English)

**Mirsad** is an integrated **monitoring and compliance** web application for organizations. It helps teams **record violations**, attach evidence, and move each case through a structured workflow: **employee response → supervisor review → internal audit → management decision → closure**. The interface is **Arabic-first with RTL layout**; numeric and date fields are shown in **Latin digits** where appropriate for readability.

The codebase is a **single static SPA** in `index.html` (no build step). Data lives in **Supabase** (PostgreSQL, Row Level Security, Auth, and Realtime subscriptions). **Optional** integrations include **Cloudflare R2** for attachments (via a **Supabase Edge Function** that issues S3-compatible presigned URLs; secrets never ship to the browser) and another Edge Function for privileged admin user operations.

**Quick links (repository files):**

- [index.html](index.html) — full application source (open on GitHub to browse or **Raw** to download).
- [supabase/functions/r2-storage/](supabase/functions/r2-storage/) — Edge Function for R2 presigning (deploy to your Supabase project).
- [README.md](README.md) — this documentation file.

---

## نظرة عامة (عربي)

منصة **مرصاد** لرصد المخالفات ودعم **الامتثال المؤسسي**: تسجيل تذكرة، مرفقات، ثم تمرير الحالة بين **الموظف والمشرف والمدقق والمدير** حتى الإغلاق. الواجهة **عربية RTL** مع أرقام/تواريخ لاتينية حيث يلزم.

تقنيًا: تطبيق ثابت في ملف **`index.html`** يتصل بـ **Supabase**؛ رفع المرفقات إلى **Cloudflare R2** يتم عبر **Edge Function** (`r2-storage`) مع بقاء مفاتيح R2 في أسرار Supabase؛ عمليات المستخدمين الحساسة عبر **Edge Function** أخرى عند التفعيل.

**روابط سريعة:**

- [index.html](index.html) — كود التطبيق الكامل.
- [supabase/functions/r2-storage/](supabase/functions/r2-storage/) — دالة الحافة لتوقيع روابط R2.
- [README.md](README.md) — ملف التوثيق هذا.

---

## Features (English)

- **Dashboard** with KPIs and charts (Latin numerals/dates where used).
- **New violation** capture and **ticket workflow** with filters, search, and clear state badges.
- **Reports** and **compliance** views (regions, branches, employees).
- **Regions & branches**, **users**, and **violation types** catalog (severity and weight).
- **Mirsad UI:** purple / white / light gray, soft card shadows, **pill** buttons and search fields, light sidebar with purple active state.
- **Auth** screens (login, forgot/reset) as centered cards.

---

## الميزات (عربي)

- **لوحة تحكم** مع مؤشرات أداء ومخططات؛ أرقام وتواريخ بصيغة لاتينية حيث يلزم.
- **رصد مخالفة** و**معالجة التذاكر** مع فلترة وبحث وتدفق حالات واضح.
- **التقارير** و**مؤشرات الامتثال** (مناطق / فروع / موظفين).
- **إدارة المناطق والفروع**، **المستخدمون**، **أنواع المخالفات** (كتالوج مع خطورة ووزن).
- **واجهة مرصاد (Mirsad UI):** بنفسجي / أبيض / رمادي فاتح، بطاقات بظل ناعم، أزرار وأشرطة بحث على شكل **pill**، شريط جانبي فاتح مع حالة تفعيل بنفسجية.
- **تسجيل دخول** واستعادة كلمة المرور بتصميم بطاقة وسط الشاشة.

---

## Repository layout

```
.
├── index.html              # Full app: HTML + CSS + JS (~17k lines)
├── supabase/
│   ├── config.toml         # Edge Function settings (e.g. verify_jwt)
│   └── functions/
│       └── r2-storage/
│           └── index.ts    # R2 presign + server-side move (copy/delete)
├── .gitignore
└── README.md
```

---

## Prerequisites

- متصفح حديث.
- مشروع **Supabase** مع الجداول والسياسات (RLS) المناسبة.
- (اختياري لكن مُستحسَن للإنتاج) دلو **Cloudflare R2** ونشر الدالة `r2-storage` على Supabase مع أسرار R2 (انظر القسم التالي).
- (اختياري للترحيل) مسار `GET /config` على نفس نطاق الاستضافة يعيد JSON لمفاتيح R2 — **غير مُستحسن** لأن المفاتيح تصل للمتصفح.

**English**

- A modern browser.
- A **Supabase** project with correct tables and RLS.
- (Recommended) **Cloudflare R2** + deploy the **`r2-storage`** Edge Function with R2 secrets (next section).
- (Legacy) `GET /config` on the same origin — **not recommended** (keys exposed to the browser).

---

## Cloudflare R2 + Supabase (الربط النظامي)

### العربية

1. في **Cloudflare → R2** أنشئ دلوًا (Bucket) ومفتاح **S3 API** بصلاحيات قراءة/كتابة على الدلو، واحفظ **Account ID**.
2. في **Supabase → Edge Functions → Secrets** أضف للدالة `r2-storage` القيم:
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_ACCOUNT_ID`
   - `R2_BUCKET_NAME`

إذا ظهر في المتصفح **503** على طلب `.../functions/v1/r2-storage` فالدالة منشورة لكن **الأسرار الأربعة غير مضبوطة** (أو أسماؤها لا تطابق ما تتوقعه الدالة).

3. من جهازك ثبّت [Supabase CLI](https://supabase.com/docs/guides/cli) (مثلاً Scoop أو ثنائي من [Releases](https://github.com/supabase/cli/releases)). **لا تستخدم** `npm install -g supabase` — غير مدعوم.

من **مجلد المشروع** الذي فيه `supabase/functions/`:

```bash
cd path/to/this/repo
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase functions deploy r2-storage
```

بدون تثبيت CLI دائم يمكن استخدام:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <YOUR_PROJECT_REF>
npx supabase@latest functions deploy r2-storage
```

التطبيق يستدعي تلقائيًا  
`https://<ref>.supabase.co/functions/v1/r2-storage`  
مع JWT المستخدم. الدالة تعيد روابط **موقّعة مؤقتًا**؛ المتصفح يرفع/يقرأ مباشرة من R2 دون استلام المفتاح السري.

إذا لم تُنشر الدالة (404)، يُحاول التطبيق المسار القديم `/config` إن وُجد على نفس النطاق.

### English

1. In **Cloudflare → R2**, create a bucket and an **S3 API** token with read/write; keep **Account ID**.
2. In **Supabase → Edge Functions → Secrets**, add `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`.

If the browser shows **503** on `.../functions/v1/r2-storage`, the function is deployed but **those secrets are missing or misnamed**.

3. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) (e.g. Scoop or a binary from [Releases](https://github.com/supabase/cli/releases)). **Do not use** `npm install -g supabase`.

From the **repo root** (where `supabase/functions/` lives):

```bash
cd path/to/this/repo
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase functions deploy r2-storage
```

Or without a global install:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <YOUR_PROJECT_REF>
npx supabase@latest functions deploy r2-storage
```

The SPA calls presigned URLs only; secrets stay in Supabase. If the function is missing (404), the app may fall back to same-origin `/config` (legacy).

---

## Quick start (local)

1. استنسخ المستودع أو نزّل الملفات.
2. افتح المجلد بخادم ثابت محلي (مثلاً Live Server في VS Code، أو `npx serve`).

```bash
npx serve .
```

3. افتح الرابط الذي يعرضه الخادم (مثلاً `http://localhost:3000`).

**Note:** On `file://`, Supabase and R2 flows need an HTTP server. By default the app **skips real R2 on `localhost`** (local previews). To test **Edge + R2 like production** on Live Server, open the browser console and run:  
`localStorage.setItem('mirsad_force_r2_local','1'); location.reload();`  
Turn off with:  
`localStorage.removeItem('mirsad_force_r2_local'); location.reload();`  
You must be **logged in** and have **`r2-storage`** deployed with R2 secrets.

**ملاحظة:** على `file://` تحتاج خادم HTTP. على `localhost` الافتراضي هو تخطي R2 الحقيقي. لاختبار R2 كالإنتاج من Live Server استخدم الكونسول:  
`localStorage.setItem('mirsad_force_r2_local','1'); location.reload();`  
والإيقاف:  
`localStorage.removeItem('mirsad_force_r2_local'); location.reload();`  
يلزم **تسجيل دخول** ودالة **`r2-storage`** مع أسرار R2.

## Configuration

في `index.html` داخل قسم **CONFIGURATION** (بحث عن `SUPABASE_URL`):

| Constant | Purpose |
|----------|---------|
| `SUPABASE_URL` | عنوان مشروع Supabase |
| `SUPABASE_ANON` | مفتاح **Publishable / anon** (آمن في المتصفح مع RLS صحيح) |
| `R2_STORAGE_FN_URL` | يُشتق في الكود من `SUPABASE_URL` → `/functions/v1/r2-storage` |
| `CLOUDFLARE_WORKER_URL` | مسار اختياري للعارض (افتراضي `/upload`) |
| `ADMIN_FN_URL` | Edge Function لعمليات المستخدمين الإدارية |

لا ترفع مفاتيح إنتاج حقيقية إلى مستودع عام دون تدويرها لاحقًا. استخدم قيم بيئة منفصلة أو استضافة تضيف الإعدادات من الخادم إن أمكن.

**Local dev auto-login:** على `localhost` فقط يمكن تفعيل تسهيلات التطوير عبر `DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` في نفس القسم — اتركهما فارغين للإنتاج ولا ترفع بيانات دخول إلى Git.

---

## Roles (high level)

| Role | Arabic label (in app) |
|------|------------------------|
| `admin` | مدير النظام |
| `manager` | المدير |
| `auditor` | المدقق |
| `supervisor` | المشرف |
| `employee` | الموظف |
| `observer` | الراصد |

عناصر القائمة الجانبية تُظهر/تُخفى حسب `data-roles` على كل تبويب.

---

## Ticket workflow (states)

تمر التذكرة عبر حالات مثل: `emp` → `sup` → `aud` → `mgt` → `closed` (مع حالات وسيطة مثل الرفع). التفاصيل والأزرار في منطق JavaScript داخل `index.html` (دوال المعالجة والتقديم على التذكرة).

---

## Tech stack

- HTML5، CSS (متغيرات تصميم `--mr-*` وتوافق مع `--blue` القديمة)، JavaScript (بدون bundler).
- [@supabase/supabase-js](https://github.com/supabase/supabase-js) من CDN.
- Font Awesome 6، خطوط Google (IBM Plex Sans Arabic، إلخ).

---

## License

لم يُحدد ترخيص في هذا المستودع بعد. أضف ملف `LICENSE` عند الحاجة.

---

## Contributing

Issues و Pull requests مرحب بها بعد إضافة سياسة مساهمة إن رغبت الفريق بذلك.
