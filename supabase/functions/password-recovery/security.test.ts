import {
  canIssueRecovery,
  hasUsableRecoveryRateLimitSalt,
  MIN_RECOVERY_RATE_LIMIT_SALT_BYTES,
  recoveryCounterHash,
  verifiedRecoveryClientIp,
} from "./_shared.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("لا يعامل أي IP header كدليل مصدر قبل توثيق proxy", () => {
  const forgedOnly = new Request("https://example.test", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  assert(verifiedRecoveryClientIp(forgedOnly) === null, "XFF وحده غير موثوق");

  const matchingHeaders = new Request("https://example.test", {
    headers: {
      "cf-connecting-ip": "198.51.100.4",
      "x-forwarded-for": "203.0.113.9, 198.51.100.4",
    },
  });
  assert(
    verifiedRecoveryClientIp(matchingHeaders) === null,
    "تطابق الرؤوس ليس إثباتاً لمصدرها؛ الفشل مغلق",
  );
});

Deno.test("مفاتيح العداد HMAC مفصولة المجال ولا تعيد البريد أو IP خاماً", async () => {
  const email = await recoveryCounterHash(
    "local-test-salt",
    "email",
    "user@example.test",
  );
  const ip = await recoveryCounterHash("local-test-salt", "ip", "198.51.100.8");
  assert(/^[0-9a-f]{64}$/.test(email), "مفتاح البريد HMAC hex");
  assert(/^[0-9a-f]{64}$/.test(ip), "مفتاح IP HMAC hex");
  assert(email !== ip, "فصل نطاق البريد وIP إلزامي");
  assert(
    !email.includes("user@example.test") && !ip.includes("198.51.100.8"),
    "لا PII في المفتاح",
  );
});

Deno.test("الحساب النشط المربوط بـ Auth يسمح بلا allowlist أدوار إضافية", () => {
  assert(
    canIssueRecovery({
      auth_uid: "00000000-0000-0000-0000-000000000001",
      is_active: true,
    }),
    "يكفي الحساب النشط المرتبط بـ Auth",
  );
  assert(
    !canIssueRecovery({
      auth_uid: "00000000-0000-0000-0000-000000000001",
      is_active: false,
    }),
    "الحساب غير النشط لا يرسل له",
  );
  assert(
    !canIssueRecovery({ auth_uid: null, is_active: true }),
    "يلزم ربط Auth",
  );
  assert(!canIssueRecovery(null), "الحساب غير الموجود لا يرسل له");
});

Deno.test("ملح عداد الاستعادة لا يقبل القيمة الفارغة أو القصيرة", () => {
  assert(
    !hasUsableRecoveryRateLimitSalt(
      "x".repeat(MIN_RECOVERY_RATE_LIMIT_SALT_BYTES - 1),
    ),
    "الحد الأدنى 32 بايت",
  );
  assert(
    hasUsableRecoveryRateLimitSalt(
      "x".repeat(MIN_RECOVERY_RATE_LIMIT_SALT_BYTES),
    ),
    "يسمح فقط بحد 32 بايت أو أكثر؛ يجب توليده عشوائياً في الإعداد",
  );
});
