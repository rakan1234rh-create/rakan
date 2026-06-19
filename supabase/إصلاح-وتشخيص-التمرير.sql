-- ═══════════════════════════════════════════════════════════════════════════
-- مرصاد — إصلاح وتشخيص التمرير التلقائي (شغّله مرة واحدة كاملاً في SQL Editor)
-- ───────────────────────────────────────────────────────────────────────────
-- يضمن:
--   1) وجود الإضافات (pg_cron / pg_net)
--   2) سجل تشغيل (mirsad_cron_runs) يثبت أن الكرون يعمل ويلتقط أي خطأ
--   3) دالة غلاف (mirsad_auto_forward_tick) تسجّل كل تشغيلة
--   4) إعادة جدولة الكرون كل دقيقة على الدالة الصحيحة
--   5) تشخيص فوري في النهاية يوضّح أين الخلل بالضبط
-- المتطلب المسبق: أن تكون شغّلت mirsad-auto-forward-sql.sql مسبقاً
-- (دالة public.mirsad_auto_forward_overdue_violations موجودة).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- ─── 1) جدول سجل التشغيل (للمراقبة وإثبات عمل الكرون) ───
create table if not exists public.mirsad_cron_runs (
  id        bigint generated always as identity primary key,
  ran_at    timestamptz not null default now(),
  result    jsonb,
  error     text
);
alter table public.mirsad_cron_runs enable row level security;

-- ─── 2) دالة الغلاف: تنادي التمرير وتسجّل النتيجة/الخطأ ───
create or replace function public.mirsad_auto_forward_tick()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res jsonb;
begin
  begin
    v_res := public.mirsad_auto_forward_overdue_violations();
    insert into public.mirsad_cron_runs (result, error) values (v_res, null);
  exception when others then
    insert into public.mirsad_cron_runs (result, error)
    values (null, 'SQLSTATE ' || SQLSTATE || ': ' || SQLERRM);
  end;
end;
$$;

grant execute on function public.mirsad_auto_forward_tick() to postgres;

-- ─── 3) إعادة جدولة الكرون (كل دقيقة) على دالة الغلاف ───
select cron.unschedule(jobid)
from cron.job
where jobname = 'athar-violation-auto-forward';

select cron.schedule(
  'athar-violation-auto-forward',
  '* * * * *',
  $$ select public.mirsad_auto_forward_tick(); $$
);

-- ─── 4) تشغيلة فورية واحدة الآن (لا تنتظر الدقيقة) ───
select public.mirsad_auto_forward_tick();


-- ═══════════════════════════════════════════════════════════════════════════
-- 🔎 التشخيص — انظر النتائج بالترتيب لتعرف أين الخلل
-- ═══════════════════════════════════════════════════════════════════════════

-- (أ) هل الإضافات مثبّتة؟  المتوقع: صفّان pg_cron و pg_net
select '(أ) extensions' as check, extname
from pg_extension
where extname in ('pg_cron', 'pg_net');

-- (ب) هل مهمة الكرون موجودة ومفعّلة؟  المتوقع: صفّ واحد active=true schedule='* * * * *'
select '(ب) cron job' as check, jobid, jobname, schedule, active, left(command, 60) as command
from cron.job
where jobname = 'athar-violation-auto-forward';

-- (ج) هل الكرون نفّذ فعلاً؟  المتوقع بعد دقيقة-دقيقتين: صفوف status='succeeded'
--     إن كانت status='failed' فاقرأ return_message لمعرفة السبب
select '(ج) cron runs' as check, runid, status, left(return_message, 80) as msg, start_time
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'athar-violation-auto-forward')
order by start_time desc
limit 10;

-- (د) سجل دالة التمرير: result يبيّن scanned/forwarded/pushed، و error إن وُجد
select '(د) tick log' as check, id, ran_at, result, error
from public.mirsad_cron_runs
order by ran_at desc
limit 10;

-- (هـ) كم مخالفة مستحقة التمرير الآن؟  (emp تجاوزت 24 ساعة ولم تُمرَّر)
select '(هـ) overdue emp' as check, count(*) as overdue_emp
from public.violations
where state = 'emp'
  and coalesce(auto_forwarded_emp, false) = false
  and created_at <= now() - interval '24 hours';

-- (و) هل مفاتيح التنبيه مخزّنة؟  المتوقع: service_role_key (len كبير ~200+) و supabase_url
select '(و) secrets' as check, key, length(value) as value_len
from public.mirsad_secrets
order by key;

-- ═══════════════════════════════════════════════════════════════════════════
-- كيف تقرأ النتيجة:
--   • إن كان (ب) فارغاً  → الكرون لم يكن مجدولاً (هذا سبب عدم التمرير) — تم إصلاحه الآن.
--   • إن كان (ج) status=failed → اقرأ msg؛ غالباً صلاحيات أو اسم دالة.
--   • إن كان (د) error غير فارغ → خطأ داخل دالة التمرير (أرسله لي).
--   • إن كان (د) result.pushed=0 مع forwarded>0 → مشكلة مفاتيح (و) أو دالة violation-push.
--   • إن كان (و) ينقص service_role_key/supabase_url → خزّنهما:
--       select public.mirsad_set_secret('service_role_key','eyJ...');
--       select public.mirsad_set_secret('supabase_url','https://rizoafuxmqsddjfhbsmf.supabase.co');
-- ═══════════════════════════════════════════════════════════════════════════
