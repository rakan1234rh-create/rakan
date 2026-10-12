import {
  employeeLoginRateKey,
  handleEmployeeLogin,
  normalizeEmployeeNumber,
} from "./index.ts";
import { verifiedManagedClientIp } from "../_shared/client-ip.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_ANON_KEY: "anon-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  EMPLOYEE_LOGIN_RATE_LIMIT_SALT:
    "local-test-rate-limit-salt-at-least-32-bytes",
  EMPLOYEE_LOGIN_ALLOWED_ORIGINS: "https://athar-app.online",
  AUTH_INGRESS_MODE: "legacy-proxy",
  AUTH_PROXY_IP_VERIFIED: "true",
};

const getEnv = (name: string) => ENV[name];

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://edge.example.test/employee-login", {
    method: "POST",
    headers: {
      origin: "https://athar-app.online",
      "content-type": "application/json",
      "cf-connecting-ip": "198.51.100.4",
      "x-forwarded-for": "203.0.113.44, 198.51.100.4",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

type MockOptions = {
  ipAllowed?: boolean;
  employeeAllowed?: boolean;
  profile?: Record<string, unknown> | null;
  revalidated?: Record<string, unknown> | null;
  signInUserId?: string;
  signInError?: unknown;
};

function mockDependencies(options: MockOptions = {}) {
  const calls = {
    clientKeys: [] as string[],
    rateKeys: [] as string[],
    lookupCandidates: [] as string[],
    profileQueries: 0,
    deleteCalled: false,
  };
  const profile = options.profile === undefined
    ? {
      id: "00000000-0000-0000-0000-000000000010",
      email: "employee@example.test",
      auth_uid: "00000000-0000-0000-0000-000000000001",
      is_active: true,
    }
    : options.profile;
  const revalidated = options.revalidated === undefined
    ? {
      auth_uid: options.signInUserId ?? "00000000-0000-0000-0000-000000000001",
      is_active: true,
    }
    : options.revalidated;

  const serviceClient = {
    rpc: async (_name: string, args: { p_key_hash: string }) => {
      calls.rateKeys.push(args.p_key_hash);
      const isIp = calls.rateKeys.length === 1;
      return {
        data: isIp
          ? options.ipAllowed !== false
          : options.employeeAllowed !== false,
        error: null,
      };
    },
    from: (table: string) => {
      assert(table === "users", "يجب أن يستعلم handler جدول users فقط");
      return {
        select: (fields: string) => {
          if (fields === "id,email,auth_uid,is_active") {
            return {
              in: (_column: string, candidates: string[]) => {
                calls.lookupCandidates = candidates;
                return {
                  eq: async () => ({
                    data: profile ? [profile] : [],
                    error: null,
                  }),
                };
              },
            };
          }
          if (fields === "auth_uid,is_active") {
            calls.profileQueries++;
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: revalidated, error: null }),
              }),
            };
          }
          throw new Error(`unexpected select: ${fields}`);
        },
        delete: () => {
          calls.deleteCalled = true;
          throw new Error("لا يجوز مسح عداد بعد نجاح الدخول");
        },
      };
    },
  };
  const authClient = {
    auth: {
      signInWithPassword: async () => ({
        data: options.signInError ? { session: null, user: null } : {
          user: {
            id: options.signInUserId ?? "00000000-0000-0000-0000-000000000001",
          },
          session: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            expires_at: 1000000,
            token_type: "bearer",
          },
        },
        error: options.signInError ?? null,
      }),
    },
  };

  return {
    calls,
    deps: {
      getEnv,
      createClient: (_url: string, key: string) => {
        calls.clientKeys.push(key);
        return key === ENV.SUPABASE_SERVICE_ROLE_KEY
          ? serviceClient
          : authClient;
      },
    },
  };
}

Deno.test("IP الموثوق لا يأخذ XFF الأول أو x-real-ip القابلين للتزوير", () => {
  const forgedOnly = new Request("https://example.test", {
    headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.9" },
  });
  assert(
    verifiedManagedClientIp(forgedOnly, true) === null,
    "XFF/X-Real وحدهما غير موثوقين",
  );

  const mismatch = new Request("https://example.test", {
    headers: {
      "cf-connecting-ip": "198.51.100.4",
      "x-forwarded-for": "198.51.100.4, 203.0.113.9",
    },
  });
  assert(
    verifiedManagedClientIp(mismatch, true) === null,
    "يلزم تطابق آخر hop مع CF",
  );

  const valid = new Request("https://example.test", {
    headers: {
      "cf-connecting-ip": "198.51.100.4",
      "x-forwarded-for": "203.0.113.9, 198.51.100.4",
    },
  });
  assert(
    verifiedManagedClientIp(valid, true) === "198.51.100.4",
    "يستخدم IP الـ gateway المثبت فقط",
  );
});

Deno.test("المعرف الوظيفي canonical ومفتاح HMAC مفصول عن service role", async () => {
  assert(
    normalizeEmployeeNumber("00123") === "00123",
    "المعرف المبطن يبقى canonical",
  );
  assert(
    normalizeEmployeeNumber("123") === "00123",
    "المعرف غير المبطن يصبح canonical",
  );
  assert(normalizeEmployeeNumber("00000") === "00000", "الصفر قانوني ومبطن");
  assert(normalizeEmployeeNumber("12x") === null, "غير الرقمي مرفوض");

  const a = await employeeLoginRateKey(
    ENV.EMPLOYEE_LOGIN_RATE_LIMIT_SALT,
    "employee",
    "00123",
  );
  const b = await employeeLoginRateKey(
    ENV.EMPLOYEE_LOGIN_RATE_LIMIT_SALT,
    "employee",
    "00123",
  );
  const ip = await employeeLoginRateKey(
    ENV.EMPLOYEE_LOGIN_RATE_LIMIT_SALT,
    "ip",
    "198.51.100.4",
  );
  assert(a === b && /^[a-f0-9]{64}$/.test(a), "HMAC ثابت ومجزأ");
  assert(a !== ip, "فصل النطاق بين IP والموظف");
  assert(
    !a.includes("00123") && !a.includes(ENV.SUPABASE_SERVICE_ROLE_KEY),
    "لا بيانات/سر خام في المفتاح",
  );
});

Deno.test("handler يرفض Origin والـ body الكبير قبل إنشاء عميل أو اتصال", async () => {
  let createCalls = 0;
  const deps = {
    getEnv,
    createClient: () => {
      createCalls++;
      throw new Error("لا يجب الاتصال");
    },
  };
  const foreign = await handleEmployeeLogin(
    request({ employee_number: "123", password: "x" }, {
      origin: "https://attacker.example",
    }),
    deps,
  );
  assert(foreign.status === 403, "Origin غير المسموح يرفض صراحة");

  const oversizedWithoutLengthRequest = request(JSON.stringify({
    employee_number: "123",
    password: "x".repeat(5000),
  }));
  assert(
    !oversizedWithoutLengthRequest.headers.has("content-length"),
    "هذا الاختبار يتعمد غياب Content-Length",
  );
  const oversizedWithoutLength = await handleEmployeeLogin(
    oversizedWithoutLengthRequest,
    deps,
  );
  assert(
    oversizedWithoutLength.status === 400,
    "الجسم الكبير بلا Content-Length يحد ويُرفض",
  );
  assert(createCalls === 0, "لا عميل/اتصال للحالات المرفوضة مبكراً");
});

Deno.test("preflight لا يمنح CORS إلا للـ origin الصريح", async () => {
  const allowed = await handleEmployeeLogin(
    new Request("https://edge.example.test/employee-login", {
      method: "OPTIONS",
      headers: { origin: "https://athar-app.online" },
    }),
    { getEnv },
  );
  assert(allowed.status === 204, "OPTIONS المسموح يعيد 204");
  assert(
    allowed.headers.get("access-control-allow-origin") ===
      "https://athar-app.online",
    "لا يعكس handler origin اعتباطياً",
  );

  const rejected = await handleEmployeeLogin(
    new Request("https://edge.example.test/employee-login", {
      method: "OPTIONS",
      headers: { origin: "https://legacy.example.test" },
    }),
    { getEnv },
  );
  assert(rejected.status === 403, "origin legacy غير المضبوط يرفض");
  assert(
    rejected.headers.get("access-control-allow-origin") === null,
    "origin المرفوض لا يتلقى رأس CORS",
  );
});

Deno.test("handler يستخدم canonical employee key، يعيد التحقق بعد Auth، ولا يمسح IP counter", async () => {
  const { deps, calls } = mockDependencies();
  const response = await handleEmployeeLogin(
    request({ employee_number: "123", password: "correct" }),
    deps,
  );
  assert(response.status === 200, "الدخول السليم ينجح");
  assert(
    calls.clientKeys.includes(ENV.SUPABASE_SERVICE_ROLE_KEY),
    "عميل الخدمة للـ limiter",
  );
  assert(calls.clientKeys.includes(ENV.SUPABASE_ANON_KEY), "عميل anon للدخول");
  assert(
    calls.lookupCandidates.join(",") === "00123,123",
    "lookup يدعم القيمة التاريخية دون تغيير مفتاح الحد",
  );
  assert(calls.profileQueries === 1, "يعاد فحص الملف بعد signIn");
  assert(!calls.deleteCalled, "لا تمسح IP أو عداد الموظف عند النجاح");
  const expectedEmployeeKey = await employeeLoginRateKey(
    ENV.EMPLOYEE_LOGIN_RATE_LIMIT_SALT,
    "employee",
    "00123",
  );
  assert(
    calls.rateKeys.includes(expectedEmployeeKey),
    "123 و00123 يشتركان في مفتاح الحد المبطن",
  );
  const payload = await response.json() as Record<string, unknown>;
  assert(
    payload.access_token === "access-token",
    "لا تعاد tokens إلا بعد إعادة الفحص",
  );
});

Deno.test("handler لا يعيد tokens إذا تغير auth_uid أو عُطّل الملف بعد signIn", async () => {
  for (
    const revalidated of [
      { auth_uid: "00000000-0000-0000-0000-000000000099", is_active: true },
      { auth_uid: "00000000-0000-0000-0000-000000000001", is_active: false },
    ]
  ) {
    const { deps } = mockDependencies({ revalidated });
    const response = await handleEmployeeLogin(
      request({ employee_number: "00123", password: "correct" }),
      deps,
    );
    assert(
      response.status === 401,
      "تغير الربط/التفعيل يخفي tokens ويرفض الدخول",
    );
    const payload = await response.json() as Record<string, unknown>;
    assert(!("access_token" in payload), "لا token في الرد المرفوض");
  }
});

Deno.test("handler يوقف قبل lookup حين يحجب أحد العدادين", async () => {
  const { deps, calls } = mockDependencies({ employeeAllowed: false });
  const response = await handleEmployeeLogin(
    request({ employee_number: "123", password: "wrong" }),
    deps,
  );
  assert(response.status === 429, "حظر العداد يعيد 429 عاماً");
  assert(calls.lookupCandidates.length === 0, "لا استعلام ملف عند حظر العداد");
});

Deno.test("شرط ingress غير المثبت يمنع الدخول قبل أي اتصال", async () => {
  const { deps, calls } = mockDependencies();
  const response = await handleEmployeeLogin(
    request({ employee_number: "123", password: "correct" }),
    {
      ...deps,
      getEnv: (name) =>
        name === "AUTH_PROXY_IP_VERIFIED" ? undefined : getEnv(name),
    },
  );
  assert(response.status === 503, "عدم اعتماد المصدر يفشل مغلقاً");
  assert(calls.clientKeys.length === 0, "لا اتصال خلفي قبل اعتماد المصدر");
});
