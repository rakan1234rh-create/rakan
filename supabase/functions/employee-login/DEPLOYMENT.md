# متطلبات نشر `employee-login`

لا تنشر أو تفعّل الدالة قبل ضبط المتغيرات التالية في **بيئة Edge Function** (لا في الواجهة):

| المتغير | الشرط |
|---|---|
| `EMPLOYEE_LOGIN_ALLOWED_ORIGINS` | قائمة origins HTTPS صريحة مفصولة بفواصل، مثل `https://athar-app.online`. لا توجد قيم افتراضية أو نطاقات legacy. |
| `EMPLOYEE_LOGIN_RATE_LIMIT_SALT` | سر عشوائي مستقل بطول **32 بايت على الأقل**. لا تعِد استعمال `SUPABASE_SERVICE_ROLE_KEY`. |
| `SUPABASE_URL`، `SUPABASE_ANON_KEY`، `SUPABASE_SERVICE_ROLE_KEY` | مفاتيح الدالة المعتادة؛ service role لا يغادر الخادم. |

## تحقق proxy إلزامي

الدالة تفشل مغلقاً ما لم يكن `cf-connecting-ip` عنوان IP صحيحاً ومطابقاً **لآخر** hop في `x-forwarded-for`. قبل التفعيل، نفّذ طلباً تجريبياً من origin المصرح به عبر بوابة Supabase/Cloudflare وتحقق من هذا التطابق في بيئة غير إنتاجية أو سجلات منصة غير حساسة. يجب كذلك التحقق أن أي مسار مباشر لا يسمح للعميل بتمرير رأسين مزورين كما لو كانا من البوابة. لا تعتمد `x-real-ip` أو أول عنصر في XFF.

بعد الضبط شغّل محلياً:

```sh
/home/ubuntu/.deno/bin/deno test --allow-read --allow-net supabase/functions/employee-login/*.test.ts
```

لا يتصل الاختبار بـ Supabase؛ جميع العملاء mocks.

## شرط الإصدار المشترك

المعالج الآن يستخدم `../_shared/client-ip.ts` ويقرأ `AUTH_PROXY_IP_VERIFIED`. يجب تركه غير مفعّل حتى إثبات أن بوابة النشر تضبط CF-Connecting-IP وآخر XFF ولا يوجد تجاوز مباشر. نجاح مطابقة رأسين لا يثبت مصدرهما. بعد التحقق المستقل ومع تجهيز الأسرار والأصول، يفعّل المسؤول الشرط. الافتراضي 503 دون أي استدعاء Auth. لا تُنشر الواجهة قبل التحقق.
