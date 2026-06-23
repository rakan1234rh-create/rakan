-- ═══════════════════════════════════════════════════════════════════════════
-- ATHAR — جدولة انتهاء نشرات الجوال (عند الموعد فقط — بدون polling)
-- شغّل: supabase/on-demand-scheduling.sql (يشمل النشرات + إلغاء الكرون القديم)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.broadcasts
  add column if not exists expires_at timestamptz,
  add column if not exists expiry_cron_job_name text;

comment on column public.broadcasts.expires_at is
  'موعد حذف النشرة وصناديق الوارد والتنبيهات المرتبطة — يُجدول pg_cron عند هذا الموعد';
comment on column public.broadcasts.expiry_cron_job_name is
  'اسم مهمة pg_cron لحذف النشرة عند expires_at';

-- المنطق الكامل في: supabase/on-demand-scheduling.sql
