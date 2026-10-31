# بيئة staging للواجهة فقط — ATHAR

نسخة اختبارية **للواجهة** (شكل وتجربة الاستخدام)، منفصلة عن نشر الإنتاج على `athar-app.online`.

## الرابط

- **الأساسي:** [https://athar-staging.pages.dev](https://athar-staging.pages.dev)
- اختياري لاحقاً: `https://staging.athar-app.online` (يتطلب سجل DNS عند Hostinger → CNAME إلى `athar-staging.pages.dev` ثم إضافة النطاق في Cloudflare Pages → athar-staging → Custom domains).

لا يُنشر staging على GitHub Pages الإنتاجي، ولا تحت `/staging/` على النطاق الرسمي.

## كيف يعمل النشر

1. فرع Git: `staging`
2. مشروع Cloudflare Pages: `athar-staging` (مرتبط بالمستودع؛ فرع الإنتاج فيه = `staging`)
3. أي دفع إلى `staging` ينشر الواجهة تلقائياً على `athar-staging.pages.dev`
4. شريط أصفر ثابت «نسخة تجريبية» يظهر تلقائياً على مضيفي staging فقط (`data-athar-env=staging`)

الإنتاج يبقى من فرع `main` عبر workflow GitHub Pages → `athar-app.online` دون تغيير.

## تعديل الواجهة

```bash
git fetch origin
git checkout staging
# عدّل HTML / CSS / JS الخاصة بالشكل
git add -A && git commit -m "ui: ..."
git push origin staging
```

انتظر اكتمال نشر Cloudflare Pages ثم افتح الرابط أعلاه مع تحديث قوي للمتصفح.

## الترقية إلى الإنتاج

1. افتح Pull Request من `staging` → `main` (أو ادمج فقط ملفات الواجهة المطلوبة).
2. راجع أن التغييرات واجهة فقط؛ لا تدمج workflow يمس `github-pages` أو مسارات `/staging/` على النطاق الرسمي.
3. بعد الموافقة والدمج في `main`، ينشر GitHub Pages الإنتاج كالمعتاد.
4. **لا تدمج إلى `main` دون موافقة صريحة.**

## الخلفية (Supabase / R2)

staging واجهة فقط. تسجيل الدخول والبيانات تستخدم نفس خلفية الإنتاج عند الحاجة لعرض الشاشات. لا مشروع Supabase منفصل لهذه البيئة. الشريط «نسخة تجريبية» يوضح أنك لست على واجهة الإنتاج.

## حواجز أمان مهمة

- Environment `github-pages` يجب أن يبقى على فرع `main` فقط (احذف سياسة فرع `staging` إن وُجدت).
- لا تعِد تفعيل workflow قديم ينشر `main` + `/staging/` على نفس موقع Pages.
