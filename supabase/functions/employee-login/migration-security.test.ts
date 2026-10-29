const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20261012202000_security_users.sql",
    import.meta.url,
  ),
);
const retryAfterMigration = await Deno.readTextFile(
  new URL(
    "../../migrations/20261029193000_employee_login_rate_limit_retry_after.sql",
    import.meta.url,
  ),
);
const app = await Deno.readTextFile(
  new URL("../../../js/app.js", import.meta.url),
);
const handler = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("مهاجرة users ذرية وتبقي self SELECT للملف المعطل فقط", () => {
  assert(
    migration.trimStart().startsWith("-- Security hardening"),
    "ملف الهجرة صحيح",
  );
  assert(
    /\bBEGIN;/.test(migration) && /\bCOMMIT;\s*$/.test(migration),
    "الهجرة مغلفة بمعاملة",
  );
  assert(
    migration.includes(
      "auth_uid = auth.uid()\n    OR (\n      public.current_user_is_active()",
    ),
    "self SELECT لا يشترط نشاط الحساب؛ الإدارة/الآخرون فقط يشترطون النشاط",
  );
  assert(
    migration.includes(
      "REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.users FROM PUBLIC, anon, authenticated;",
    ),
    "تسحب امتيازات تجاوز RLS من authenticated وanon",
  );
});

Deno.test("trigger حارس الحقول موجود فعلاً وACL الخاص به مغلق", () => {
  for (
    const required of [
      "DROP TRIGGER IF EXISTS athar_guard_users_sensitive_trg ON public.users;",
      "CREATE TRIGGER athar_guard_users_sensitive_trg",
      "EXECUTE FUNCTION public.athar_guard_users_sensitive();",
      "REVOKE ALL ON FUNCTION public.athar_guard_users_sensitive() FROM PUBLIC;",
      "REVOKE ALL ON FUNCTION public.athar_guard_users_sensitive() FROM anon, authenticated;",
      "ARRAY['avatar_key', 'updated_at']",
    ]
  ) assert(migration.includes(required), `ينقص trigger/ACL: ${required}`);
});

Deno.test("RLS directory يقتصر على الحقول المحدودة والحسابات النشطة", () => {
  assert(
    migration.includes("WHERE u.is_active IS TRUE"),
    "لا يعرض الدليل حسابات معطلة",
  );
  const directorySection = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.get_user_directory()"),
    migration.indexOf(
      "DROP FUNCTION IF EXISTS public.get_email_by_emp_number(text);",
    ),
  );
  for (const forbidden of ["email", "phone", "auth_uid", "employee_number"]) {
    assert(
      !new RegExp(`\\bu\\.${forbidden}\\b`).test(directorySection),
      `الدليل لا يعيد ${forbidden}`,
    );
  }
  assert(
    app.includes(
      "if (canManageUsers()) {\n          return sb.from('users').select(MOB_USER_SELECT).order('name');\n        }",
    ) &&
      app.includes("const { data, error } = await sb.rpc(USER_DIRECTORY_RPC);"),
    "خريطة employee_number/filter/export الكاملة محصورة في مسار canManageUsers",
  );
  assert(
    app.includes(".update({ avatar_key: keyToSave })") &&
      app.includes(".eq('id', u.id)"),
    "تعديل صورة الملف يكتب avatar_key لملف المستخدم الحالي فقط",
  );
});

Deno.test("عداد الدخول server-only ومحدد ولا يحذف عداد النجاح", () => {
  for (
    const required of [
      "key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$')",
      "interval '15 minutes'",
      "interval '1 hour'",
      "REVOKE ALL PRIVILEGES ON TABLE public.employee_login_rate_limits FROM anon, authenticated;",
      "REVOKE ALL ON FUNCTION public.consume_employee_login_rate_limit(text) FROM anon, authenticated;",
      "GRANT EXECUTE ON FUNCTION public.consume_employee_login_rate_limit(text) TO service_role;",
      "DROP FUNCTION IF EXISTS public.get_email_by_emp_number(text);",
    ]
  ) assert(migration.includes(required), `عداد/إزالة RPC ينقصه: ${required}`);
  assert(
    !migration.includes(
      "REVOKE ALL ON FUNCTION public.get_email_by_emp_number(text)",
    ),
    "لا revoke على دالة قد تكون غائبة",
  );
  assert(
    !handler.includes(".delete()"),
    "handler لا يمسح IP counter بعد نجاح الدخول",
  );
  assert(
    handler.includes("EMPLOYEE_LOGIN_RATE_LIMIT_SALT"),
    "ملح حد الدخول مستقل",
  );
  assert(
    !handler.includes("encode(SUPABASE_SERVICE_ROLE_KEY)"),
    "لا يستعمل service_role كملح HMAC",
  );
});

Deno.test("هجرة retry_after تُبقي العداد server-only وتعرض دقائق الانتظار", () => {
  for (
    const required of [
      "DROP FUNCTION IF EXISTS public.consume_employee_login_rate_limit(text);",
      "RETURNS TABLE (allowed boolean, retry_after_seconds integer)",
      "REVOKE ALL ON FUNCTION public.consume_employee_login_rate_limit(text) FROM anon, authenticated;",
      "GRANT EXECUTE ON FUNCTION public.consume_employee_login_rate_limit(text) TO service_role;",
    ]
  ) {
    assert(
      retryAfterMigration.includes(required),
      `هجرة مدة الانتظار ينقصها: ${required}`,
    );
  }
  assert(
    handler.includes('code: "rate_limited"') &&
      handler.includes("retry_after_minutes") &&
      handler.includes("انتظر"),
    "handler يعيد رمز القفل ورقم الدقائق",
  );
  assert(
    app.includes("formatLoginWaitMinutes") &&
      app.includes("isLoginRateLimit") &&
      app.includes("بيانات الدخول غير صحيحة."),
    "الواجهة تفرّق بين القفل وبيانات الدخول وتعرض رقم الدقائق",
  );
});
