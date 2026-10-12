-- تأمين الحاوية القديمة فقط: التطبيق الحالي يستخدم R2 ولا توجد إحالة مصدرية إلى
-- violation-attachments. لا ننشئ الحاوية ولا نحذف أي كائن أو بيانات موجودة.
--
-- 50 MiB وقائمة MIME الضيقة تتركان هامشاً لاسترداد مرفقات صور/PDF قديمة، مع منع
-- الرفع العام للملفات التنفيذية أو الأنواع غير المتوقعة. مسار R2 الحالي مستقل.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]::text[]
WHERE id = 'violation-attachments';

-- السياسات القديمة كانت تتيح لأي authenticated الرفع والحذف في كامل الحاوية.
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete own" ON storage.objects;

-- اجعل إعادة تطبيق migration آمنة في بيئة مراجعة/استعادة.
DROP POLICY IF EXISTS legacy_violation_attachments_select_own_or_admin ON storage.objects;
DROP POLICY IF EXISTS legacy_violation_attachments_insert_own ON storage.objects;
DROP POLICY IF EXISTS legacy_violation_attachments_delete_own_or_admin ON storage.objects;

-- يتعامل owner_id مع الإصدارات الحديثة من Storage وowner مع الكائنات القديمة.
-- نفضّل owner_id عند وجوده كي لا يوسّع تعارض legacy غير متوقع نطاق الوصول.
-- الاستثناء الإداري مقصود للقراءة/الحذف فقط: مدير منصة نشط قد يحتاج استرداد أو
-- تنظيف كائن legacy يتيم؛ لا يمنح الاستثناء إنشاء كائن باسم مالك آخر.
CREATE POLICY legacy_violation_attachments_select_own_or_admin
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'violation-attachments'
    AND public.current_user_is_active()
    AND (
      COALESCE(NULLIF(owner_id, ''), owner::text) = (SELECT auth.uid()::text)
      OR public.is_platform_admin()
    )
  );

CREATE POLICY legacy_violation_attachments_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'violation-attachments'
    AND public.current_user_is_active()
    AND COALESCE(NULLIF(owner_id, ''), owner::text) = (SELECT auth.uid()::text)
  );

CREATE POLICY legacy_violation_attachments_delete_own_or_admin
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'violation-attachments'
    AND public.current_user_is_active()
    AND (
      COALESCE(NULLIF(owner_id, ''), owner::text) = (SELECT auth.uid()::text)
      OR public.is_platform_admin()
    )
  );
