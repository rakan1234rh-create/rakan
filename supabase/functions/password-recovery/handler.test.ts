import { handlePasswordRecovery } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("handler يرفض الطريقة وorigin غير المسموح قبل أي مسار خادمي", async () => {
  const method = await handlePasswordRecovery(
    new Request("https://example.test", { method: "GET" }),
  );
  assert(method.status === 405, "GET يجب أن يرفض");

  const foreignOrigin = await handlePasswordRecovery(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "user@example.test" }),
    }),
  );
  assert(foreignOrigin.status === 403, "origin غير المسموح يجب أن يرفض");
});

Deno.test("handler يرفض body غير صالح وIP غير مثبت بدون طلب قاعدة أو Auth", async () => {
  const invalidBody = await handlePasswordRecovery(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        origin: "https://athar-app.online",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
  );
  assert(invalidBody.status === 400, "الصيغة غير الصالحة يجب أن ترفض");

  const oversizedBody = await handlePasswordRecovery(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        origin: "https://athar-app.online",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: `${"a".repeat(3000)}@example.test` }),
    }),
  );
  assert(oversizedBody.status === 400, "الجسم الكبير يجب أن يرفض قبل أي خدمة");

  const missingTrustedIp = await handlePasswordRecovery(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        origin: "https://athar-app.online",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "user@example.test" }),
    }),
  );
  assert(missingTrustedIp.status === 503, "غياب IP الموثق يفشل مغلقاً");
  const body = await responseJson(missingTrustedIp);
  assert(
    body.error === "recovery_temporarily_unavailable",
    "لا يكشف الرد حالة الحساب",
  );
});

Deno.test("handler يوقف قارئ body المتدفق فور تجاوز 2048 بايت", async () => {
  const encoder = new TextEncoder();
  let pulls = 0;
  let cancelled = false;
  const oversizedStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(encoder.encode("x".repeat(pulls === 1 ? 2048 : 1)));
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await handlePasswordRecovery(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        origin: "https://athar-app.online",
        "content-type": "application/json",
      },
      body: oversizedStream,
    }),
  );

  assert(response.status === 400, "الجسم المتدفق الكبير يجب أن يرفض");
  assert(pulls === 2, "لا يقرأ handler بعد أول chunk متجاوز");
  assert(cancelled, "يلزم إلغاء القارئ عند تجاوز الحد");
});

Deno.test("preflight مسموح فقط كـ CORS ولا يشغل الاستعادة", async () => {
  const response = await handlePasswordRecovery(
    new Request("https://example.test", {
      method: "OPTIONS",
      headers: { origin: "https://athar-app.online" },
    }),
  );
  assert(response.status === 204, "OPTIONS يجب أن يعيد 204");
  assert(
    response.headers.get("access-control-allow-origin") ===
      "https://athar-app.online",
    "CORS للإنتاج فقط",
  );
});
