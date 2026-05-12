# مرصاد — Mirsad Monitoring Platform

## Overview (English)

**Mirsad** is an integrated **monitoring and compliance** web application for organizations. It helps teams **record violations**, attach evidence, and move each case through a structured workflow: **employee response → supervisor review → internal audit → management decision → closure**. The interface is **Arabic-first with RTL layout**; numeric and date fields are shown in **Latin digits** where appropriate for readability.

The codebase is a **single static SPA** in `index.html` (no build step). Data lives in **Supabase** (PostgreSQL, Row Level Security, Auth, and Realtime subscriptions). **Optional** integrations include **Cloudflare R2** for attachments (via a small upload worker) and a **Supabase Edge Function** for privileged admin user operations.

**Quick links (repository files):**

- [index.html](index.html) — full application source (open on GitHub to browse or **Raw** to download).
- [README.md](README.md) — this documentation file.

---

## نظرة عامة (عربي)

منصة **مرصاد** لرصد المخالفات ودعم **الامتثال المؤسسي**: تسجيل تذكرة، مرفقات، ثم تمرير الحالة بين **الموظف والمشرف والمدقق والمدير** حتى الإغلاق. الواجهة **عربية RTL** مع أرقام/تواريخ لاتينية حيث يلزم.

تقنيًا: تطبيق ثابت في ملف **`index.html`** يتصل بـ **Supabase**؛ رفع الملفات عبر **R2** اختياري؛ عمليات المستخدمين الحساسة عبر **Edge Function** عند التفعيل.

**روابط سريعة:**

- [index.html](index.html) — كود التطبيق الكامل.
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
├── index.html   # Full app: HTML + CSS + JS (~17k lines)
├── .gitignore
└── README.md
```

---

## Prerequisites

- متصفح حديث.
- مشروع **Supabase** مع الجداول والسياسات (RLS) المناسبة.
- (اختياري) خادم رفع للمرفقات مثل Worker على مسار `/upload` وملف إعداد `/config` إن استخدمت تكامل R2 كما في الكود.

---

## Quick start (local)

1. استنسخ المستودع أو نزّل الملفات.
2. افتح المجلد بخادم ثابت محلي (مثلاً Live Server في VS Code، أو `npx serve`).

```bash
npx serve .
```

3. افتح الرابط الذي يعرضه الخادم (مثلاً `http://localhost:3000`).

**Note:** بعض المسارات مثل `fetch('/config')` لا تعمل عند فتح `index.html` مباشرة من نظام الملفات (`file://`). استخدم خادمًا محليًا.

---

## Configuration

في `index.html` داخل قسم **CONFIGURATION** (بحث عن `SUPABASE_URL`):

| Constant | Purpose |
|----------|---------|
| `SUPABASE_URL` | عنوان مشروع Supabase |
| `SUPABASE_ANON` | مفتاح **Publishable / anon** (آمن في المتصفح مع RLS صحيح) |
| `CLOUDFLARE_WORKER_URL` | مسار رفع الملفات (افتراضي `/upload`) |
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
