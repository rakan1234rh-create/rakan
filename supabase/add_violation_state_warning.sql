-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — إضافة قيمة Warning_Issued إلى enum violation_state
-- ═══════════════════════════════════════════════════════════════════════════
-- يُشغّل من Supabase Dashboard → SQL Editor، أو عبر CLI/psql.
-- IF NOT EXISTS يجعل التشغيل آمنًا لتكراره.
-- ═══════════════════════════════════════════════════════════════════════════

alter type public.violation_state add value if not exists 'Warning_Issued';
