/*
 * عنوان Worker بوابة المصادقة الموقعة.
 *
 * اترك القيمة فارغة قبل اعتماد rollout؛ عندها تستمر الواجهة في استخدام
 * مسارات Supabase المباشرة المتوافقة مع الإصدار المنشور الحالي. بعد نشر
 * Worker ومهاجرة replay ووظائف Edge بوضع signed، ضع عنوان HTTPS الجذري
 * للـWorker هنا فقط، مثل: https://athar-auth-ingress.<account>.workers.dev
 * لا تضع أي مفتاح أو HMAC أو URL فيه query/fragment في هذا الملف.
 */
window.ATHAR_AUTH_INGRESS_BASE_URL = "";
