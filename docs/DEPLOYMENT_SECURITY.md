# تشغيل آمن للنشر — ATHAR

> **حالة هذا المستند:** خطة تنفيذ ومراجعة شيفرة فقط. لا يغيّر Cloudflare أو DNS أو GitHub Environments أو Supabase، ولا ينشر أي artifact أو دالة أو migration.

## ما تغيّر في المستودع

- يبني `.github/workflows/deploy-pages.yml` الـartifact من `main` فقط. لم يعد يعمل checkout لفرع `staging` أو ينسخ أي مسار منه إلى Pages.
- يرفض build نفسه ومرحلة deploy التشغيل من أي ref غير `refs/heads/main`، حتى عند تشغيل `workflow_dispatch` يدوياً من ref آخر.
- توجد طبقتان لاختبار عدم تسرب staging:
  1. `scripts/test-deploy-security.mjs` يفحص مصدر workflow قبل الدمج.
  2. workflow Pages يفشل إن وجد `site/staging` بعد بناء artifact.
- `apply-sql-fixes.yml` لا يعمل إلا على `main`، يعمل checkout مثبتاً لـ`main` بلا بيانات Git دائمة، ويستدعي `scripts/validate-sql-migration-path.sh`. المدقق يرفض `..` و`//` والروابط الرمزية والمسارات المطلقة والملفات غير الموجودة وأي ملف خارج `supabase/migrations` أو ليس migration باسم timestamp من 14 رقماً.
- نشر Edge مقصور على `main` ويشمل `password-recovery` و`employee-login`. يبقى `--no-verify-jwt` فقط للوظائف التي يلزمها قبول webhook أو رابط موقّع أو سر cron/service أو مسار bootstrap بلا جلسة؛ أما `admin-users` فينشر مع تحقق JWT في البوابة **بالإضافة** إلى تحققه الداخلي من المستخدم النشط وصلاحية `manage_users`.
- توجد مرحلة preflight قبل أول أمر deploy: تفشل إن غاب `index.ts` لأي وظيفة في القائمة. بذلك لا يعيد تعديل workflow نشر الوظائف الحالية جزئياً بينما ما زال مصدر `password-recovery` أو `employee-login` غير مدمج.

## حالة staging والشرط الإداري المتبقي

لا يحذف هذا التغيير فرع `staging` أو تاريخه أو بياناته. لكنه لا يجعل الفرع قناة نشر للنطاق الرسمي.

فحص القراءة فقط لإعداد GitHub الحالي وجد أن Environment `github-pages` يسمح بفرعين: `main` و`staging`. لذلك يلزم مالك المستودع، بعد مراجعة التغيير وقبل release، أن يحذف سياسة فرع `staging` من **Settings → Environments → github-pages → Deployment branches** ويُبقي `main` فقط. لا يُنشأ هذا الإجراء من هذا العمل، ولا توجد موافقة GitHub أُنشئت هنا.

هذا الإعداد مهم لأن نسخة workflow القديمة الموجودة في فرع `staging` قد تُشغّل يدوياً من ذلك الفرع ما دام Environment يسمح به. بعد تعديل policy، لا يستطيع هذا المسار نشر artifact إلى Environment Pages الرسمي. لا تحذف الفرع ولا تعِد استخدامه على نفس النطاق؛ إن لزم اختبار staging مستقبلاً، خصص نطاقاً وEnvironment ومشروع Supabase منفصلين.

## حماية GitHub المطلوبة قبل تفعيل SQL أو النشر

فحص القراءة فقط وجد أن `main` غير محمي حالياً. لا يكفي شرط `if` في YAML وحده إذا كان بإمكان أي شخص دفع workflow جديد مباشرة إلى `main`.

على مسؤول المستودع إعداد الآتي يدوياً، ثم مراجعة الأثر في إعدادات GitHub:

1. حماية `main`: طلب Pull Request، ومراجعة واحدة على الأقل من مالك/مراجع مسؤول، ومنع force-push والحذف، وتقييد من يملك push/تجاوز الحماية.
2. جعل حالة **Deploy security checks / source-security** required قبل الدمج، مع اشتراط أن يكون الفرع محدثاً قبل الدمج.
3. قصر Environment `github-pages` على `main` فقط كما سبق، وعدم إضافة rule يتيح `staging` أو pattern واسعاً.
4. إنشاء Environment منفصل مثل `production-sql` لمرحلة SQL مع required reviewers من مالكي قاعدة البيانات، ثم ربط job `apply` به في تغيير لاحق بعد موافقة صريحة. لا يضيف هذا التغيير Environment أو مراجعين من تلقاء نفسه.
5. إبقاء `SUPABASE_ACCESS_TOKEN` في Actions secret فقط وعدم طباعته. لا يسمح للمشغّل إلا بتشغيل migration موجودة ومتحققاً من مسارها على `main`.

## رؤوس HTTP: قيد GitHub Pages واقتراح دقيق

GitHub Pages لا يوفّر ملف `_headers` أو إعداد مستودع يضيف رؤوس HTTP مخصّصة. الملف `index.html` يملك `meta http-equiv="Content-Security-Policy"` كدفاع محدود للمستند، لكنه **لا** ينشئ `Strict-Transport-Security`، ولا `X-Content-Type-Options`، ولا `Referrer-Policy`، ولا `Permissions-Policy`. كما لا يمكن الاعتماد على CSP داخل meta لتطبيق `frame-ancestors`.

لا تضف ملف `_headers` إلى هذا artifact على أنه حل؛ Pages سيتجاهله. لا تغيّر Cloudflare أو DNS ضمن هذا rollout. عند اتخاذ قرار لاحق باستخدام proxy أو CDN يدعم تعديل response headers، يطبّق المسؤول الخريطة التالية على `athar-app.online` بعد اختبارها في نطاق منفصل:

| المطابقة | الرأس والقيمة الدقيقة | ملاحظة أمان |
|---|---|---|
| كل الردود HTTPS | `Strict-Transport-Security: max-age=31536000` | لا تضف `includeSubDomains` أو `preload` إلا بعد إثبات أن كل النطاقات الفرعية الحالية والمستقبلية HTTPS دائماً. لا يمكن وضع HSTS في meta. |
| كل الردود | `X-Content-Type-Options: nosniff` | آمن للملفات الثابتة وواجهات API المتوقعة. |
| كل الردود | `Referrer-Policy: strict-origin-when-cross-origin` | يمنع تسريب المسار والاستعلامات إلى وجهات خارجية مع بقاء أصل الإحالة المفيد. |
| كل الردود | `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()` | لا يفترض صلاحيات لا يستعملها التطبيق. أضف صلاحية فقط بعد اختبار وظيفة تحتاجها. |
| كل الردود | `X-Frame-Options: DENY` | طبّقه فقط بعد تأكيد عدم وجود تكامل شرعي يضمّن الواجهة في iframe. |
| كل الردود، بعد اختبار CSP | `Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://static.cloudflareinsights.com blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; media-src 'self' blob: data: https:; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://cdn.jsdelivr.net https://timeapi.io https://fonts.googleapis.com https://fonts.gstatic.com https://static.cloudflareinsights.com https://cloudflareinsights.com; frame-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://*.supabase.co; worker-src 'self' blob: https://cdn.jsdelivr.net; manifest-src 'self'` | القيمة تعكس allowlist الحالية ولا توسعها. `unsafe-inline` و`unsafe-eval` دين تقني حالي مرتبط بـffmpeg.wasm؛ لا تحذف أيّاً منهما قبل اختبار التحويل والـPWA. اختبر أولاً بوضع Report-Only في نطاق تجريبي ثم نفّذ الرأس. |

لا تضف `Content-Security-Policy-Report-Only` من دون endpoint يجمع التقارير بصورة تحمي الخصوصية. لا تضف أي header إلى الإنتاج ضمن هذه الوحدة.

### cache وService Worker

الفحص الحالي لـ`sw.js` يبين أنه يتعامل مع push وnotification click فقط: لا يوجد listener لـ`fetch` ولا API لـ`CacheStorage`. لذلك لا يستطيع worker الاحتفاظ بصفحة `/staging/` أو إعادة تقديمها بعد إزالة artifact. قد يبقى تسجيل worker قديم محدود النطاق `/staging/` في متصفح مستخدم زاره سابقاً، لكنه لا يتحكم في `/` ولا يعترض الطلبات. في المقابل، GitHub Pages يعيد حالياً `Cache-Control: max-age=600` للـHTML و`sw.js`.

عند وجود proxy داعم للرؤوس لاحقاً، استخدم للـHTML وملفات التحكم التالية `Cache-Control: no-cache, max-age=0, must-revalidate`:

- `/`, `/index.html`, `/start/`, `/start/index.html`
- `/app-version.json`, `/sw.js`, `/manifest.webmanifest`

لا تضع `immutable` عالمياً على `styles/` أو `js/` الآن، لأن أسماء كل الأصول ليست fingerprinted. يمكن لاحقاً إعطاء `public, max-age=31536000, immutable` للأصول التي تحمل hash/نسخة ثابتة فقط. يفحص التطبيق `app-version.json` بـ`cache: 'no-store'` ويضيف SHA إلى `app.js` وقت build، لكن ذلك لا يعوض رأس HTTP للـHTML.

## روابط البريد القديمة في main

المراجعة المصدرية الحالية لـ`main` وجدت أن `send-auth-emails` يمنع محتوى `List-Unsubscribe` ورابط `settings?unsubscribe=` في بريد recovery/OTP، وأن `email-unsubscribe` يقبل token موقّعاً فقط. اختبار `scripts/test-mail-unsub-hardening.mjs` يحرس هذه العقود. بقيت رؤوس `List-Unsubscribe` في رسائل التنبيه/الملخصات غير المتعلقة بتسجيل الدخول، وهي منفصلة عن مسار OTP وليست رابط بريد خام في main.

النسخة القديمة في `origin/staging` ما زالت تحتوي رابط `settings?unsubscribe=<email>` ورأسي unsubscribe في `send-auth-emails`. إزالة artifact من النطاق الرسمي وإزالة سياسة Environment الخاصة بـstaging هما العزل المطلوب؛ لا تُشغّل ذلك الفرع لإرسال بريد.

## تسلسل rollout الإلزامي

1. **ضبط حواجز GitHub أولاً:** حماية `main`، status check المطلوب، وإزالة `staging` من سياسة `github-pages`. لا تجرّب dispatch من staging.
2. **مراجعة ودمج وظائف Edge ومصادر migrations:** يجب أن تكون شيفرتا `supabase/functions/password-recovery/` و`supabase/functions/employee-login/` موجودتين قبل تشغيل workflow. لكل endpoint بلا JWT، راجع التحقق الداخلي قبل النشر: مدخلات مقيدة، rate limit موثوق، رد موحّد لا يكشف وجود الحساب، والتحقق من المستخدم النشط. في employee-login تحقّق أيضاً من الدور/الموظف المسموح قبل إنشاء الجلسة. لا يحقق workflow وحده هذه الخصائص.
3. **نشر وظائف Edge من main ثم تطبيق migrations المعتمدة من main:** انشر الوظائف أولاً كي يبقى مسار موثوق جاهزاً قبل سحب RPC القديم، ثم طبّق migrations بالترتيب المعتمد بعد مراجعة SQL. لا تشغّل SQL من branch أو path يدوي. لا ترسل OTP أو بريد اختبار.
4. **اختبارات سلبية في بيئة آمنة قبل الواجهة:** طلب بلا JWT إلى `admin-users` يجب أن يفشل في البوابة؛ مستخدم JWT غير نشط يجب أن يرفض؛ مستخدم نشط بلا `manage_users` يجب أن يرفض؛ مدير نشط مخوّل فقط يمر. اختبر `password-recovery` و`employee-login` لرقم/بريد غير معروف، حساب غير نشط، دور غير مسموح، rate limit، وtoken/secret خاطئ، من دون إنشاء حسابات أو إرسال بريد. اختبر cron وwebhook بتوقيع/سر خاطئ فيجب أن يرفضا.
5. **انشر Pages من main فقط:** راجع artifact ونجاح `test ! -e site/staging`، ثم تحقق HTTP أن `/staging/` لم يعد 200 بعد انتهاء TTL/cache. افحص `/` و`/start/` وOTP UI بعد refresh كامل.
6. **الرؤوس لاحقاً وبصورة مستقلة:** إن تقرر proxy، ابدأ بـCSP Report-Only في نطاق اختبار، ثم طبّق الخريطة أعلاه. لا تصف meta CSP على أنه HSTS.

لا يوجد أي إجراء لإرسال رسالة إلى Apple في هذا التسلسل.

### حواجز الإصدار وفترة التحديث

أضيف حاجزان يفشلان مغلقًا: `ATHAR_SECURITY_EDGE_RELEASE_APPROVED` يمنع نشر Edge تلقائيًا لمجرد دمج PR، و`ATHAR_SECURITY_BACKEND_READY` يمنع نشر الواجهة قبل جاهزية الخلفية. اتركهما غير مفعّلين أثناء المراجعة والدمج. لم يضبط هذا العمل أي متغير في GitHub.

المسار المعتمد الجديد لمصدر IP هو بوابة Cloudflare موقعة، لا افتراض أن رؤوس Supabase موثوقة. تظل قيمة `AUTH_PROXY_IP_VERIFIED=false`، ويضبط الإصدار المراجع `AUTH_INGRESS_MODE=signed` مع `AUTH_INGRESS_HMAC_SECRET` مشترك بين Worker وEdge ومهاجرة `20261012210000_auth_ingress_replay.sql`. ترفض Edge الطلب المباشر غير الموقع قبل إنشاء عميل service-role. توجد تفاصيل البناء وتسلسل الإطلاق والتراجع في [`cloudflare/auth-ingress-worker/README.md`](../cloudflare/auth-ingress-worker/README.md). لا تفعّل حواجز GitHub حتى يكتمل هذا التسلسل وتُراجع نتيجة الاختبار.

استبدال وظائف R2 وسحب RPC القديمة قبل تحديث الواجهة قد يسبب رفضًا مؤقتًا لطلبات العملاء القديمة؛ تطبق الحزمة في نافذة صيانة معلنة أو عبر إصدار متدرج بعقد متوافق موثق. لا يقدم هذا الترتيب على أنه تحديث بلا انقطاع.

تطابق آخر XFF مع CF-Connecting-IP لا يكفي وحده لإثبات أن بوابة Supabase تضبطهما. لا يستخدم وضع `signed` هذه الرؤوس عند وصولها إلى Supabase: يستقبل Worker طلب المتصفح، ويرفض Worker subrequests الغامضة، ويوقّع العنوان الذي رآه قبل أن يمرر الطلب. نقاط Auth المباشرة مثل `/auth/v1/recover` تبقى عامة وتحكمها حدود Supabase. نقل Auth إلى Edge قد يجعل حدود IP الأصلية مشتركة بين مستخدمي خادم الوظيفة. توجيه `Sb-Forwarded-For` يتطلب مفتاح `sb_secret` حديثًا وتفعيلًا صريحًا في إعدادات Auth، ولا يعمل بمفتاح legacy service_role؛ لا تغيّر ذلك دون مراجعة وموافقة. راجع [وثائق حدود Supabase](https://supabase.com/docs/guides/auth/rate-limits) و[رؤوس Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## التراجع

- **Pages:** أنشئ revert commit موثقاً على `main` للـworkflow/واجهة السابقة بعد موافقة الحماية، ثم انشر artifact من `main` فقط. لا تستخدم فرع `staging` كتراجع ولا تعيد `/staging/` إلى النطاق الرسمي.
- **Edge:** احتفظ بمعرّف version وآخر SHA لكل وظيفة قبل release. إن ظهر عطل، أعد نشر آخر مصدر معروف من `main`/tag بعد مراجعة الاعتماديات. لا تعطل التحقق الداخلي أو توسع `--no-verify-jwt` كحل سريع.
- **SQL:** لا تحذف أو تعكس migration أمنية عمياء في الإنتاج. أنشئ migration تصحيحية forward-only بعد مراجعة أثر البيانات والـcron/service role؛ التراجع البرمجي للواجهة لا يعكس schema تلقائياً.
- **Headers:** بما أن هذه الوحدة لم تغير proxy أو DNS أو Cloudflare، لا يوجد rollback خارجي مطلوب. إن طُبقت الرؤوس لاحقاً، يكون التراجع في نفس طبقة proxy فقط مع حفظ القيم السابقة.

## ما لم تنفذه هذه الوحدة

- لم تنشر، ولم تدفع commit، ولم تدمج، ولم تطبق migration، ولم تنشئ GitHub approval أو Environment أو branch policy.
- لم تغير Cloudflare أو DNS أو أسرار أو صلاحيات حسابات أو بيانات موظفين.
- عُدّلت واجهة المصادقة لتستعمل Worker فقط عند ضبط عنوانه الصريح في `js/auth-ingress-config.js`؛ لم يُعدّل كود المرفقات.
- جُمعت شيفرة `password-recovery` و`employee-login` واختباراتها مع مصدر Worker موقّع ومهاجرة منع إعادة الإرسال. لم يُنشر Worker أو Edge أو migration ولم تُضبط أسرار أو DNS أو Cloudflare. الإطلاق يتطلب `AUTH_INGRESS_MODE=signed` وHMAC مشتركاً وأسرار حدود قوية وأصول CORS معتمدة؛ لا يتطلب ولا يبرر تفعيل `AUTH_PROXY_IP_VERIFIED=true`.
