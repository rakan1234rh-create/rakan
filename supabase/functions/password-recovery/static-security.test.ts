const app = await Deno.readTextFile(
  new URL("../../../js/app.js", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20261012201000_security_recovery.sql",
    import.meta.url,
  ),
);
const fn = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const ingress = await Deno.readTextFile(
  new URL("../_shared/auth-ingress.ts", import.meta.url),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("الواجهة لا تستدعي Auth recovery أو RPC العدادات القديمة مباشرة", () => {
  assert(
    !app.includes("sb.auth.resetPasswordForEmail("),
    "يلزم أن يكون إرسال الاستعادة خلف Edge",
  );
  assert(
    !app.includes("sb.rpc('record_password_reset_attempt'"),
    "RPC التسجيل القديم محذوف من الواجهة",
  );
  assert(
    !app.includes("sb.rpc('check_password_reset_rate_limit'"),
    "RPC الفحص القديم محذوف من الواجهة",
  );
  assert(
    !app.includes("sb.rpc('clear_password_reset_attempts'"),
    "RPC المسح القديم محذوف من الواجهة",
  );
  assert(app.includes("sb.auth.verifyOtp({"), "تدفق تحقق OTP يبقى في الواجهة");
  assert(
    app.includes("sb.auth.updateUser({ password: newPw })"),
    "تعيين كلمة المرور بعد OTP يبقى في الواجهة",
  );
});

Deno.test("migration يقيد العدادات بالمفاتيح المجزأة وTTL وservice_role فقط", () => {
  for (
    const required of [
      "key_hash text NOT NULL CHECK (key_hash ~",
      "expires_at timestamptz NOT NULL",
      "CREATE INDEX IF NOT EXISTS password_recovery_rate_limits_expires_at_idx",
      "REVOKE ALL ON FUNCTION public.consume_password_recovery_rate_limit(text, text)",
      "TO service_role",
      "REVOKE ALL ON FUNCTION public.clear_password_reset_attempts(text)",
    ]
  ) assert(migration.includes(required), `migration ينقصه: ${required}`);
});

Deno.test("الاستهلاك لا ينظف عالمياً ويعيد النافذة المنتهية ذرياً بعد الأقفال", () => {
  const consumeStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.consume_password_recovery_rate_limit",
  );
  const consumeEnd = migration.indexOf(
    "REVOKE ALL ON FUNCTION public.consume_password_recovery_rate_limit",
  );
  const consume = migration.slice(consumeStart, consumeEnd);
  const cleanup = migration.slice(consumeEnd);

  for (
    const required of [
      "p_email_key_hash IS NULL",
      "p_ip_key_hash IS NULL",
      "pg_advisory_xact_lock",
      "FOR UPDATE",
      "WHEN public.password_recovery_rate_limits.expires_at <= v_now THEN 1",
    ]
  ) assert(consume.includes(required), `استهلاك limiter ينقصه: ${required}`);
  assert(!consume.includes("DELETE FROM"), "لا يصح تنظيف TTL أثناء الاستهلاك");
  assert(
    cleanup.includes("FOR UPDATE SKIP LOCKED"),
    "cleanup يجب ألا ينتظر أقفال الاستهلاك",
  );
  assert(
    cleanup.includes("LIMIT c_batch_size"),
    "cleanup يجب أن يبقى محدود الدفعة",
  );
});

Deno.test("الدالة لا تسجل أو تعيد email أو OTP أو سر العداد", () => {
  assert(!fn.includes("console."), "لا سجلات حساسة في الدالة");
  assert(
    !fn.includes("token") && !fn.includes("otp"),
    "الدالة لا تتعامل مع OTP",
  );
  assert(
    fn.includes("verifiedAuthIngress(") &&
      fn.includes('expectedPath: "/functions/v1/password-recovery"'),
    "لا تستخدم الدالة IP header غير مثبت",
  );
  assert(
    ingress.includes("AUTH_INGRESS_HMAC_SECRET") &&
      ingress.includes('mode === "signed"') &&
      ingress.includes('mode !== "legacy-proxy"'),
    "البوابة الموقعة تفشل مغلقاً ولا تعود بصمت إلى رؤوس proxy",
  );
  assert(!fn.includes("req.text()"), "قراءة body يجب أن تبقى محدودة متدفقة");
  assert(
    fn.includes("resetPasswordForEmail("),
    "يلزم بقاء مسار Auth الطبيعي",
  );
});
