#!/usr/bin/env bash
# اختبار محلي معزول لـ 20261012200000_security_rpc_hardening.sql.
# لا يتصل بـ Supabase ولا يقرأ أو يكتب بياناته.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261012200000_security_rpc_hardening.sql"
PGBIN="$(pg_config --bindir)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/athar-rpc-hardening.XXXXXX")"
SOCKET_DIR="$TMP/socket"
DATA_DIR="$TMP/data"
PORT="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"

cleanup() {
  if [[ -f "$DATA_DIR/postmaster.pid" ]]; then
    "$PGBIN/pg_ctl" -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

[[ -f "$MIGRATION" ]] || { echo "ملف migration مفقود: $MIGRATION" >&2; exit 1; }
mkdir -p "$SOCKET_DIR"
"$PGBIN/initdb" -D "$DATA_DIR" --auth=trust --no-locale -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$DATA_DIR" -o "-F -p $PORT -k $SOCKET_DIR" -w start >/dev/null

psql_local() {
  psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -p "$PORT" -d postgres "$@"
}

# أدنى schema/dummies تسمح بتجميع واختبار الدوال الحقيقية في migration.
psql_local >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE postgres NOLOGIN;
GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE EXTENSION pgcrypto;
CREATE TYPE public.violation_state AS ENUM (
  'emp', 'sup', 'aud', 'mgt', 'hr', 'closed', 'Warning_Issued', 'uploading'
);

CREATE TABLE public.violations (
  id uuid PRIMARY KEY,
  ticket_number text,
  employee_id uuid,
  branch_id uuid,
  violation_type text,
  state public.violation_state NOT NULL DEFAULT 'emp',
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status_text text,
  employee_reply text,
  supervisor_reply text,
  audit_reply text,
  management_reply text,
  hr_reply text,
  auto_forwarded_emp boolean NOT NULL DEFAULT false,
  auto_forwarded_sup boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  emp_forward_after timestamptz,
  sup_forward_after timestamptz
);
CREATE TABLE public.violation_forward_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id uuid NOT NULL REFERENCES public.violations(id),
  direction text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  cron_job_name text
);
CREATE TABLE public.athar_secrets (key text PRIMARY KEY, value text);
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

CREATE FUNCTION public.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.current_user_is_active() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('test.active', true), ''), 'false')::boolean $$;
CREATE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.role', true), '') $$;
CREATE FUNCTION public.current_user_supervised_branches() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT COALESCE(
  string_to_array(NULLIF(current_setting('test.branches', true), ''), ',')::uuid[],
  ARRAY[]::uuid[]
) $$;
CREATE FUNCTION public.user_has_platform_perm(p_permission text) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT p_permission = ANY(COALESCE(
  string_to_array(NULLIF(current_setting('test.permissions', true), ''), ','),
  ARRAY[]::text[]
)) $$;
CREATE FUNCTION public.athar_next_workflow_state(p_state text) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT CASE p_state
  WHEN 'emp' THEN COALESCE(NULLIF(current_setting('test.next_emp', true), ''), 'sup')
  WHEN 'sup' THEN COALESCE(NULLIF(current_setting('test.next_sup', true), ''), 'aud')
  WHEN 'aud' THEN COALESCE(NULLIF(current_setting('test.next_aud', true), ''), 'mgt')
  WHEN 'mgt' THEN COALESCE(NULLIF(current_setting('test.next_mgt', true), ''), 'hr')
  WHEN 'hr' THEN COALESCE(NULLIF(current_setting('test.next_hr', true), ''), 'closed')
END $$;
CREATE FUNCTION public.athar_workflow_stage_skipped(text) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT false $$;
CREATE FUNCTION public.athar_sup_stage_start_time(jsonb, boolean, timestamptz, timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT $4 $$;
CREATE FUNCTION public.athar_now_ksa_text() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'اختبار' $$;

CREATE FUNCTION public.athar_cancel_forward_jobs(uuid, text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.athar_schedule_forward_job_at(uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.athar_unschedule_forward_cron(text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.athar_auto_forward_overdue_violations() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.athar_process_forward_jobs(integer DEFAULT 50) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.athar_auto_forward_tick() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.auto_forward_violations() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.athar_auto_forward_single(uuid, text, timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.append_violation_log(uuid, jsonb, text DEFAULT NULL, text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.append_violation_log_with_guard(
  uuid, text, jsonb, text DEFAULT NULL, text DEFAULT NULL, text DEFAULT NULL,
  text DEFAULT NULL, jsonb DEFAULT NULL, boolean DEFAULT false, boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

psql_local -f "$MIGRATION" >/dev/null

# ACL: لا يستطيع anon/authenticated تنفيذ أي دالة خدمة داخلية، في حين يستمر
# service_role وpostgres، وتبقى واجهة الحارس لمستخدم authenticated فقط.
psql_local >/dev/null <<'SQL'
CREATE FUNCTION public.test_assert(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION '%', p_message;
  END IF;
END;
$$;

SELECT public.test_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'athar_assert_internal_invocation', 'append_violation_log',
        'athar_auto_forward_single', 'athar_auto_forward_single_canonical',
        'athar_auto_forward_overdue_violations', 'athar_enqueue_forward_job',
        'athar_process_forward_jobs', 'athar_backfill_notifications_recent',
        'athar_auto_forward_tick', 'athar_execute_forward_job',
        'athar_schedule_forward_job_at', 'athar_cancel_forward_jobs',
        'athar_unschedule_forward_cron', 'auto_forward_violations'
      ])
      AND (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  'ACL: وصلت anon أو authenticated إلى دالة داخلية'
);

SELECT public.test_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'athar_assert_internal_invocation', 'append_violation_log',
        'athar_auto_forward_single', 'athar_auto_forward_single_canonical',
        'athar_auto_forward_overdue_violations', 'athar_enqueue_forward_job',
        'athar_process_forward_jobs', 'athar_backfill_notifications_recent',
        'athar_auto_forward_tick', 'athar_execute_forward_job',
        'athar_schedule_forward_job_at', 'athar_cancel_forward_jobs',
        'athar_unschedule_forward_cron', 'auto_forward_violations'
      ])
      AND (
        NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        OR NOT has_function_privilege('postgres', p.oid, 'EXECUTE')
      )
  ),
  'ACL: فُقد تنفيذ service_role أو postgres لدالة داخلية'
);

SELECT public.test_assert(
  NOT has_function_privilege(
    'anon',
    'public.append_violation_log_with_guard(uuid,text,jsonb,text,text,text,text,jsonb,boolean,boolean)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'public.append_violation_log_with_guard(uuid,text,jsonb,text,text,text,text,jsonb,boolean,boolean)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.append_violation_log_with_guard(uuid,text,jsonb,text,text,text,text,jsonb,boolean,boolean)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    'postgres',
    'public.append_violation_log_with_guard(uuid,text,jsonb,text,text,text,text,jsonb,boolean,boolean)'::regprocedure,
    'EXECUTE'
  ),
  'ACL: واجهة الحارس لا تملك مصفوفة التنفيذ المتوقعة'
);
SQL

# حالات المستخدم: غير نشط، مستخدم نشط لكن غير مالك، محاولة انتقال مزور، ثم
# انتقال الموظف الصحيح. تُنفذ من role=authenticated داخل قاعدة الاختبار.
psql_local >/dev/null <<'SQL'
INSERT INTO public.violations (
  id, ticket_number, employee_id, state, created_at, updated_at, emp_forward_after
) VALUES
  ('00000000-0000-0000-0000-000000000101', 'T-INACTIVE', '00000000-0000-0000-0000-000000000001', 'emp', now(), now(), now() + interval '24 hours'),
  ('00000000-0000-0000-0000-000000000102', 'T-OTHER',    '00000000-0000-0000-0000-000000000001', 'emp', now(), now(), now() + interval '24 hours'),
  ('00000000-0000-0000-0000-000000000103', 'T-FORGED',   '00000000-0000-0000-0000-000000000001', 'emp', now(), now(), now() + interval '24 hours'),
  ('00000000-0000-0000-0000-000000000104', 'T-VALID',    '00000000-0000-0000-0000-000000000001', 'emp', now(), now(), now() + interval '24 hours'),
  ('00000000-0000-0000-0000-000000000105', 'T-DUE',      '00000000-0000-0000-0000-000000000001', 'emp', now(), now(), now() + interval '24 hours');

SET ROLE authenticated;
SELECT set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
SELECT set_config('test.role', 'employee', false);
SELECT set_config('test.active', 'false', false);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000101', 'emp', jsonb_build_object('action', 'test'),
    'sup', NULL, 'employee_reply', 'رد', '[]'::jsonb, true, false
  )->>'ok')::boolean, false),
  'الحارس قبل مستخدمًا غير نشط'
);

SELECT set_config('test.uid', '00000000-0000-0000-0000-000000000099', false);
SELECT set_config('test.active', 'true', false);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000102', 'emp', jsonb_build_object('action', 'test'),
    'sup', NULL, 'employee_reply', 'رد', '[]'::jsonb, true, false
  )->>'ok')::boolean, false),
  'الحارس قبل موظفًا نشطًا غير مالك للمخالفة'
);

SELECT set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000103', 'emp', jsonb_build_object('action', 'test'),
    'closed', NULL, 'employee_reply', 'رد', '[]'::jsonb, true, false
  )->>'ok')::boolean, false),
  'الحارس قبل انتقال موظف مزورًا إلى closed'
);

SELECT public.test_assert(
  COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000104', 'emp', jsonb_build_object('action', 'test'),
    'sup', NULL, 'employee_reply', 'رد', '[]'::jsonb, true, false
  )->>'ok')::boolean, false),
  'الحارس رفض انتقال الموظف المشروع إلى sup'
);
RESET ROLE;
SQL

# due_at الممرر قديم جدًا، لكن الدالة لا تمرر قبل الموعد المخزن في المخالفة؛
# والطابور يخزن الموعد الخادمي بدلاً من الوسيط الممرر.
psql_local >/dev/null <<'SQL'
SET ROLE service_role;
SELECT public.test_assert(
  (public.athar_auto_forward_single(
    '00000000-0000-0000-0000-000000000105', 'emp_to_sup', now() - interval '100 years'
  )->>'reason') = 'not_due',
  'p_due_at غير موثوق أدى إلى تمرير مبكر'
);
SELECT public.athar_enqueue_forward_job(
  '00000000-0000-0000-0000-000000000105', 'emp_to_sup', now() - interval '100 years'
);
RESET ROLE;
SELECT public.test_assert(
  (SELECT due_at > now()
   FROM public.violation_forward_jobs
   WHERE violation_id = '00000000-0000-0000-0000-000000000105'
   ORDER BY created_at DESC
  LIMIT 1),
  'الطابور خزن due_at الممرر بدلاً من موعد المخالفة'
);
SQL

# الـoverload ذو وسيطين يصل كذلك إلى المحرك canonical، والـjob القديم ذو
# due_at مزور يعاد جدولته من موعد المخالفة ولا يُنفذ مبكراً.
psql_local >/dev/null <<'SQL'
INSERT INTO public.violation_forward_jobs (id, violation_id, direction, due_at, status)
VALUES (
  '00000000-0000-0000-0000-00000000d105',
  '00000000-0000-0000-0000-000000000105',
  'emp_to_sup', now() - interval '1 minute', 'pending'
);
SET ROLE service_role;
SELECT public.test_assert(
  (public.athar_auto_forward_single(
    '00000000-0000-0000-0000-000000000105', 'emp_to_sup'
  )->>'reason') = 'not_due',
  'overload ذو وسيطين لم يقرأ الموعد canonical'
);
SELECT public.test_assert(
  (public.athar_execute_forward_job('00000000-0000-0000-0000-00000000d105')->>'reason')
    = 'rescheduled_canonical_due',
  'job مبكر لم يُعد جدولته من الموعد canonical'
);
RESET ROLE;
SELECT public.test_assert(
  (SELECT status = 'pending' AND due_at > now()
   FROM public.violation_forward_jobs
   WHERE id = '00000000-0000-0000-0000-00000000d105'),
  'job مبكر لم يحتفظ بالحالة pending والموعد الخادمي'
);
SQL

# الدفاع داخل الدوال الداخلية يقرأ claim الدور القديم وrequest.jwt.claims
# المستقلين. لا يمنع postgres/cron عندما لا توجد claims متصفح.
psql_local >/dev/null <<'SQL'
INSERT INTO public.violations (
  id, ticket_number, employee_id, state, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000106', 'V-2026-0106',
  '00000000-0000-0000-0000-000000000001', 'emp', now(), now()
);

SET ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.append_violation_log(
      '00000000-0000-0000-0000-000000000106', jsonb_build_object('action', 'legacy-claim')
    );
    RAISE EXCEPTION 'legacy browser claim was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
SELECT set_config('request.jwt.claim.role', '', false);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.append_violation_log(
      '00000000-0000-0000-0000-000000000106', jsonb_build_object('action', 'json-claim')
    );
    RAISE EXCEPTION 'JSON browser claims were accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
SELECT set_config('request.jwt.claims', '', false);
RESET ROLE;

SET ROLE postgres;
SELECT public.test_assert(
  COALESCE((public.append_violation_log(
    '00000000-0000-0000-0000-000000000106', jsonb_build_object('action', 'cron-trusted')
  )->>'ok')::boolean, false),
  'postgres/cron الموثوق مُنع بلا claims متصفح'
);
RESET ROLE;
SQL

# تغطية الردود المطلوبة والملكية والنشاط وانتقالات الإلغاء/التحذير والإغلاق
# التلقائي للـHR، مع مسار مخطط يتجاوز مراحل مهيأة.
psql_local >/dev/null <<'SQL'
INSERT INTO public.violations (
  id, ticket_number, employee_id, branch_id, state, created_at, updated_at, attachments
) VALUES
  ('00000000-0000-0000-0000-000000000107', 'V-2026-0107', '00000000-0000-0000-0000-000000000001', NULL, 'emp', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000108', 'V-2026-0108', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b001', 'sup', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000109', 'V-2026-0109', '00000000-0000-0000-0000-000000000001', NULL, 'aud', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000110', 'V-2026-0110', '00000000-0000-0000-0000-000000000001', NULL, 'mgt', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000111', 'V-2026-0111', '00000000-0000-0000-0000-000000000001', NULL, 'hr', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000112', 'V-2026-0112', '00000000-0000-0000-0000-000000000001', NULL, 'aud', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000113', 'V-2026-0113', '00000000-0000-0000-0000-000000000001', NULL, 'mgt', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000114', 'V-2026-0114', '00000000-0000-0000-0000-000000000001', NULL, 'emp', now(), now(), '[]'),
  ('00000000-0000-0000-0000-000000000115', 'V-2026-0115', '00000000-0000-0000-0000-000000000001', NULL, 'emp', now(), now(), '[{"p":"0115/existing.pdf","n":"قديم"}]');

SET ROLE authenticated;
SELECT set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
SELECT set_config('test.active', 'true', false);
SELECT set_config('test.role', 'employee', false);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000107', 'emp', jsonb_build_object('action', 'null-field'),
    'sup', NULL, NULL, NULL, NULL, false, false
  )->>'ok')::boolean, false),
  'emp قبل انتقالاً بلا employee_reply'
);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000107', 'emp', jsonb_build_object('action', 'null-text'),
    'sup', NULL, 'employee_reply', NULL, NULL, false, false
  )->>'ok')::boolean, false),
  'emp قبل حفظ رد NULL'
);

SELECT set_config('test.role', 'supervisor', false);
SELECT set_config('test.branches', '00000000-0000-0000-0000-00000000b001', false);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000108', 'sup', jsonb_build_object('action', 'null-field'),
    'aud', NULL, NULL, NULL, NULL, false, false
  )->>'ok')::boolean, false),
  'sup قبل انتقالاً بلا supervisor_reply'
);

SELECT set_config('test.role', 'auditor', false);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000109', 'aud', jsonb_build_object('action', 'null-field'),
    'closed', 'ملغاة بقرار الرقابة الداخلية', NULL, NULL, NULL, false, false
  )->>'ok')::boolean, false),
  'aud قبل إغلاقاً بلا audit_reply'
);
SELECT public.test_assert(
  COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000112', 'aud', jsonb_build_object('action', 'إلغاء'),
    'closed', 'ملغاة بقرار الرقابة الداخلية', 'audit_reply', 'ملاحظة الرقابة الداخلية', NULL, false, false
  )->>'ok')::boolean, false),
  'إجراء إلغاء الرقابة الداخلية المشروع نجح'
);

SELECT set_config('test.role', 'manager', false);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000110', 'mgt', jsonb_build_object('action', 'null-field'),
    'Warning_Issued', 'تنبيه', NULL, NULL, NULL, false, false
  )->>'ok')::boolean, false),
  'mgt قبل تحذيراً بلا management_reply'
);
SELECT public.test_assert(
  COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000113', 'mgt', jsonb_build_object('action', 'تنبيه'),
    'Warning_Issued', 'تنبيه إداري', 'management_reply', 'قرار تنبيه', NULL, false, false
  )->>'ok')::boolean, false),
  'إجراء Warning_Issued المشروع للإدارة حُجب'
);

SELECT set_config('test.role', 'viewer', false);
SELECT set_config('test.permissions', 'view_all_tickets', false);
SELECT public.test_assert(
  COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000111', 'hr', jsonb_build_object('action', 'إغلاق تلقائي'),
    'closed', 'معتمدة نهائياً', NULL, NULL, NULL, false, false
  )->>'ok')::boolean, false),
  'إغلاق قائمة HR التلقائي المشروع حُجب'
);

SELECT set_config('test.permissions', '', false);
SELECT set_config('test.role', 'employee', false);
SELECT set_config('test.next_emp', 'mgt', false);
SELECT public.test_assert(
  COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000114', 'emp', jsonb_build_object('action', 'تجاوز مراحل'),
    'mgt', NULL, 'employee_reply', 'رد في مسار متجاوز', NULL, false, false
  )->>'ok')::boolean, false),
  'الانتقال المشروع في workflow متجاوز حُجب'
);
SELECT set_config('test.next_emp', '', false);

SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000115', 'emp', jsonb_build_object('action', 'استبدال'),
    'sup', NULL, 'employee_reply', 'رد', '[{"p":"0115/forged.pdf"}]', false, false
  )->>'ok')::boolean, false),
  'الحارس قبل استبدال مصفوفة المرفقات'
);
SELECT public.test_assert(
  NOT COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000115', 'emp', jsonb_build_object('action', 'مرجع مزور'),
    'sup', NULL, 'employee_reply', 'رد', '[{"p":"0115/existing.pdf","n":"قديم"},{"p":"0999/forged.pdf"}]', false, false
  )->>'ok')::boolean, false),
  'الحارس قبل مرجع R2 خارج مجلد التذكرة'
);
SELECT public.test_assert(
  COALESCE((public.append_violation_log_with_guard(
    '00000000-0000-0000-0000-000000000115', 'emp', jsonb_build_object('action', 'مرفق صحيح'),
    'sup', NULL, 'employee_reply', 'رد مع مرفق', '[{"p":"0115/existing.pdf","n":"قديم"},{"p":"violations/00000000-0000-0000-0000-000000000115/new.pdf","n":"جديد"}]', false, false
  )->>'ok')::boolean, false),
  'إضافة مرفق في مجلد التذكرة المشروع حُجبت'
);
RESET ROLE;
SQL

# يثبت FOR UPDATE حول قراءة logs أن ردين متوازيين لا يمسح أحدهما سجل الآخر.
psql_local >/dev/null <<'SQL'
INSERT INTO public.violations (
  id, ticket_number, employee_id, state, created_at, updated_at, attachments
) VALUES (
  '00000000-0000-0000-0000-000000000116', 'V-2026-0116',
  '00000000-0000-0000-0000-000000000001', 'emp', now(), now(), '[]'
);
SQL

concurrent_guard_call() {
  local action="$1"
  local pause="$2"
  psql_local >/dev/null <<SQL
BEGIN;
SET ROLE authenticated;
SELECT set_config('test.uid', '00000000-0000-0000-0000-000000000001', true);
SELECT set_config('test.active', 'true', true);
SELECT set_config('test.role', 'employee', true);
SELECT set_config('test.next_emp', 'emp', true);
SELECT public.append_violation_log_with_guard(
  '00000000-0000-0000-0000-000000000116', 'emp', jsonb_build_object('action', '${action}'),
  'emp', NULL, 'employee_reply', '${action}', NULL, false, false
);
SELECT pg_sleep(${pause});
COMMIT;
SQL
}

concurrent_guard_call 'parallel-a' 1.5 &
pid_a=$!
sleep 0.35
concurrent_guard_call 'parallel-b' 0 &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

psql_local >/dev/null <<'SQL'
SELECT public.test_assert(
  (SELECT jsonb_array_length(logs) = 2
          AND logs @> '[{"action":"parallel-a"}]'::jsonb
          AND logs @> '[{"action":"parallel-b"}]'::jsonb
   FROM public.violations
   WHERE id = '00000000-0000-0000-0000-000000000116'),
  'سباق الردود أدى إلى lost update في logs'
);
SQL

echo 'PASS: security_rpc_hardening_test (ACL, JWT claims, roles/activity/ownership, transitions/null replies, attachments, canonical due_at, concurrency)'
