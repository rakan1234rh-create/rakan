# بوابة IP الموقعة للمصادقة

تمنع هذه البوابة أن تعتمد وظائف Supabase Edge على رؤوس IP يرسلها العميل مباشرة. لا تستقبل إلا مسارين:

- `POST /api/auth/employee-login`
- `POST /api/auth/password-recovery`

الـWorker يستقبل طلب المتصفح، ويأخذ `CF-Connecting-IP` من طلب Cloudflare المباشر فقط، ويرفض الطلبات الموسومة بـ`CF-Worker` وطلبات Worker cross-zone والحالات الغامضة. ثم يوقّع IP المطبّع وطريقة الطلب والمسار وبصمة الجسم ووقت الإصدار وnonce عشوائيًا باستخدام HMAC-SHA-256. تقبل Edge Function التوقيع لفترة قصيرة فقط، وتستهلك nonce ذريًا في PostgreSQL قبل أي Auth أو rate limit، لذلك لا يقبل عنوان Supabase المباشر الطلبات غير الموقعة بعد التفعيل.

> عنوان IP ليس هوية مستخدم. تبقى حدود البريد/الموظف والحد العام والتحقق من الحساب النشط ضرورية، لأن NAT وVPN والـproxies قد تشارك عنوانًا واحدًا.

## ما لا يفعله هذا المجلد

هذا المجلد **لا ينشر Worker**، ولا يربط DNS أو route، ولا يغيّر سرًا أو مشروع Supabase. لا تستخدمه كـPages Function ولا تنشره على wildcard. لم يظهر نطاق `athar-app.online` ضمن المناطق المتاحة للاتصال الحالي، لذلك لا تفترض أن حساب Cloudflare هذا يملك route للنطاق.

يمكن نشر Worker على `workers.dev` أولًا، ثم وضع عنوانه الجذري في `js/auth-ingress-config.js` بعد اكتمال خطوات الإطلاق. سيعمل CORS فقط من الأصل المحدد، لكنه ليس آلية مصادقة: المهاجم يستطيع إرسال Origin من عميل غير متصفح، ولذلك يظل التوقيع وحدود المعدل إلزاميين.

## الإعدادات المطلوبة

### Worker

انسخ `wrangler.toml.example` إلى مشروع Worker يتحكم به المشغل. اضبط المتغيرين غير السريين:

```toml
AUTH_INGRESS_ALLOWED_ORIGINS = "https://athar-app.online"
SUPABASE_ANON_KEY = "<publishable-or-anon-key-for-cmdkldxbocbpiptdodmp-only>"
```

لا تستخدم `service_role` أو `secret` key في Worker. أنشئ سر HMAC واحدًا محليًا في طرفية خاصة:

```bash
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'
```

لا تضع الناتج في Git أو محادثة أو Screenshot. خزّنه في Worker فقط كـsecret:

```bash
npx wrangler secret put AUTH_INGRESS_HMAC_SECRET
```

القيمة بصيغة base64url غير مبطنة وتمثل 48 بايت عشوائيًا، والحد الأدنى في الشيفرة 32 بايت. لا تنشئ endpoint يولّد توقيعات أو يعيد nonce أو signature إلى المستخدم.

### Supabase Edge Functions

في المشروع `cmdkldxbocbpiptdodmp`، أضف القيم التالية إلى **Edge Function Secrets**:

```dotenv
AUTH_INGRESS_MODE=signed
AUTH_INGRESS_HMAC_SECRET=<exact same base64url secret stored in Worker>
```

احتفظ بـ`AUTH_PROXY_IP_VERIFIED=false`. لا تجعلها `true` من أجل هذا المسار؛ الوضع `signed` لا يعتمد على CF/XFF التي تصل إلى Supabase. لا تضع اسمًا يبدأ بـ`SUPABASE_` يدويًا؛ هذه متغيرات تحقنها المنصة.

## ترتيب الإطلاق الآمن

ينفّذ الإصدار في نافذة صيانة مع القدرة على إعادة نشر آخر Edge version معروف. لا تدّعِ أنه بلا انقطاع، ولا تفعّل حواجز GitHub أو Cloudflare لمجرد أن الشيفرة مدمجة.

1. شغّل الاختبارات المحلية وCI. راجع مصدر Worker، ولا تنشره على route يشارك Pages Function أو wildcard.
2. انشر Worker أولًا إلى `workers.dev` أو route مملوك ومحدد للمسارين. اختبر طلبًا بلا `Origin` وبـOrigin أجنبي وبـGET وبطلب يحمل رؤوس `x-athar-ingress-*` مزورة: يجب ألا يصل شيء إلى Supabase.
3. طبّق migration `20261012210000_auth_ingress_replay.sql` في Supabase بعد مراجعته. لا تطبقه من جهاز محلي على production؛ استعمل مسار migrations المعتمد. اربط `cleanup_auth_ingress_replays()` بمهمة صيانة service-role موثوقة إن كان عدد الطلبات مرتفعًا؛ دالة الاستهلاك لا تنظف عالميًا أثناء الطلب.
4. ضع سر HMAC المتطابق في Supabase واضبط `AUTH_INGRESS_MODE=signed`، ثم انشر `employee-login` و`password-recovery` من المصدر المراجع. لا تمر مرحلة قصيرة يرسل فيها المستخدمون إلى Worker بينما وظائف Edge القديمة لا تعرف التوقيع، أو العكس.
5. ضع عنوان Worker الجذري في `js/auth-ingress-config.js`، مثل `https://athar-auth-ingress.<account>.workers.dev`، وانشر الواجهة في نفس نافذة الإصدار. عند وجود عنوان غير HTTPS أو يحتوي مسارًا أو query أو fragment، الواجهة تفشل بدل العودة الصامتة إلى Supabase.
6. من اتصالين مختلفين، اختبر رقم موظف/بريد اختبار مخصص لا يرسل بريدًا ولا يغير كلمة مرور. تحقق من 403 عند bypass وعودة موحدة عند nonce مكرر. لا تسجل headers أو كلمات مرور أو HMAC أو IP في تقارير المشاركة.
7. بعد الفحص، يمكن اعتماد حواجز النشر وفق `docs/DEPLOYMENT_SECURITY.md`. لا تعِد تفعيل النشر الآلي في Cloudflare قبل اكتمال هذا التسلسل.

## التراجع

إذا تعطل login أو recovery، أعد أولًا نشر آخر مصدر Edge معروف متوافق مع إعداد الواجهة، ثم أعد `js/auth-ingress-config.js` إلى قيمة فارغة في commit مراجَع. لا تحوّل `AUTH_INGRESS_MODE` إلى `legacy-proxy` أو تجعل `AUTH_PROXY_IP_VERIFIED=true` كحل سريع، لأن ذلك يعيد الثقة إلى رؤوس لم تثبت. احتفظ بسجل النسخة والوقت والسبب؛ أنشئ migration تصحيحية للأخطاء، ولا تحذف سجل replay أو تغيّر RLS يدويًا.

## المراجع

- [Cloudflare: Signing requests with HMAC](https://developers.cloudflare.com/workers/examples/signing-requests/)
- [Cloudflare: HTTP headers and Worker subrequest behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
