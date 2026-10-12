import {
  AUTH_INGRESS_HEADER_PREFIX,
  AUTH_INGRESS_VERSION,
  authIngressCanonicalMessage,
  authIngressSignature,
  bytesToBase64Url,
  decodeAuthIngressSecret,
  sha256Hex,
} from "./auth-ingress.ts";
import { handleEmployeeLogin } from "../employee-login/index.ts";
import { handlePasswordRecovery } from "../password-recovery/index.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const SECRET = bytesToBase64Url(new Uint8Array(48).fill(37));
const secretBytes = decodeAuthIngressSecret(SECRET)!;
const ORIGIN = "https://athar-app.online";
const BASE_ENV: Record<string, string> = {
  AUTH_INGRESS_MODE: "signed",
  AUTH_INGRESS_HMAC_SECRET: SECRET,
  EMPLOYEE_LOGIN_ALLOWED_ORIGINS: ORIGIN,
  ALLOWED_ORIGIN: ORIGIN,
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_ANON_KEY: "publishable-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  EMPLOYEE_LOGIN_RATE_LIMIT_SALT:
    "employee-login-rate-limit-salt-at-least-32-bytes",
  PASSWORD_RECOVERY_RATE_LIMIT_SALT:
    "password-recovery-rate-limit-salt-at-least-32-bytes",
};

async function signedRequest(
  path: "/functions/v1/employee-login" | "/functions/v1/password-recovery",
  value: Record<string, string>,
  nonceByte = 9,
): Promise<Request> {
  const body = JSON.stringify(value);
  const bytes = new TextEncoder().encode(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = bytesToBase64Url(new Uint8Array(24).fill(nonceByte));
  const clientIp = "198.51.100.9";
  const bodySha256 = await sha256Hex(bytes);
  const signature = await authIngressSignature(
    secretBytes,
    authIngressCanonicalMessage({
      method: "POST",
      path,
      timestamp,
      nonce,
      clientIp,
      bodySha256,
    }),
  );
  return new Request(`https://edge.example.test${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      [`${AUTH_INGRESS_HEADER_PREFIX}version`]: AUTH_INGRESS_VERSION,
      [`${AUTH_INGRESS_HEADER_PREFIX}timestamp`]: timestamp,
      [`${AUTH_INGRESS_HEADER_PREFIX}nonce`]: nonce,
      [`${AUTH_INGRESS_HEADER_PREFIX}ip`]: clientIp,
      [`${AUTH_INGRESS_HEADER_PREFIX}body-sha256`]: bodySha256,
      [`${AUTH_INGRESS_HEADER_PREFIX}method`]: "POST",
      [`${AUTH_INGRESS_HEADER_PREFIX}path`]: path,
      [`${AUTH_INGRESS_HEADER_PREFIX}signature`]: signature,
    },
    body,
  });
}

Deno.test("وضع signed يرفض تجاوز Edge المباشر قبل إنشاء عميل خدمة", async () => {
  let createCalls = 0;
  const deps = {
    getEnv: (name: string) => BASE_ENV[name],
    createClient: () => {
      createCalls++;
      throw new Error("must not reach Supabase for unsigned request");
    },
  };
  const directLogin = await handleEmployeeLogin(
    new Request("https://edge.example.test/functions/v1/employee-login", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ employee_number: "00123", password: "x" }),
    }),
    deps,
  );
  assert(
    directLogin.status === 503,
    "unsigned employee login must fail closed",
  );

  const directRecovery = await handlePasswordRecovery(
    new Request("https://edge.example.test/functions/v1/password-recovery", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email: "employee@example.test" }),
    }),
    deps,
  );
  assert(directRecovery.status === 503, "unsigned recovery must fail closed");
  assert(
    createCalls === 0,
    "unsigned bypass never instantiates a privileged client",
  );
});

Deno.test("التوقيع الصحيح يستهلك nonce أولاً ثم يمرر الدخول والاستعادة بعقدهما الحالي", async () => {
  const loginEvents: string[] = [];
  const loginService = {
    rpc: async (name: string) => {
      loginEvents.push(name);
      return { data: true, error: null };
    },
    from: () => ({
      select: (fields: string) => {
        if (fields === "id,email,auth_uid,is_active") {
          return {
            in: () => ({
              eq: async () => ({
                data: [{
                  id: "00000000-0000-0000-0000-000000000010",
                  email: "employee@example.test",
                  auth_uid: "00000000-0000-0000-0000-000000000001",
                  is_active: true,
                }],
                error: null,
              }),
            }),
          };
        }
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                auth_uid: "00000000-0000-0000-0000-000000000001",
                is_active: true,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  };
  const loginAuth = {
    auth: {
      signInWithPassword: async () => ({
        data: {
          user: { id: "00000000-0000-0000-0000-000000000001" },
          session: {
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 3600,
            expires_at: 100000,
            token_type: "bearer",
          },
        },
        error: null,
      }),
    },
  };
  const login = await handleEmployeeLogin(
    await signedRequest("/functions/v1/employee-login", {
      employee_number: "00123",
      password: "correct",
    }),
    {
      getEnv: (name) => BASE_ENV[name],
      createClient:
        ((_url: string, key: string) =>
          key === BASE_ENV.SUPABASE_SERVICE_ROLE_KEY
            ? loginService
            : loginAuth) as any,
    },
  );
  assert(
    login.status === 200,
    "valid signed employee login preserves the existing success path",
  );
  assert(
    loginEvents[0] === "consume_auth_ingress_replay" &&
      loginEvents.slice(1).every((name) =>
        name === "consume_employee_login_rate_limit"
      ),
    "replay consumption is before both employee-login rate limits",
  );

  const recoveryEvents: string[] = [];
  const recoveryService = {
    rpc: async (name: string) => {
      recoveryEvents.push(name);
      return name === "consume_auth_ingress_replay"
        ? { data: true, error: null }
        : { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { auth_uid: "test-auth", is_active: true },
            error: null,
          }),
        }),
      }),
    }),
  };
  const recoveryAuth = {
    auth: {
      resetPasswordForEmail: async () => ({ error: null }),
    },
  };
  const recovery = await handlePasswordRecovery(
    await signedRequest("/functions/v1/password-recovery", {
      email: "employee@example.test",
    }, 10),
    {
      getEnv: (name) => BASE_ENV[name],
      createClient:
        ((_url: string, key: string) =>
          key === BASE_ENV.SUPABASE_SERVICE_ROLE_KEY
            ? recoveryService
            : recoveryAuth) as any,
    },
  );
  assert(
    recovery.status === 202,
    "valid signed recovery preserves the uniform accepted response",
  );
  assert(
    recoveryEvents[0] === "consume_auth_ingress_replay" &&
      recoveryEvents[1] === "consume_password_recovery_rate_limit",
    "replay consumption is before the recovery rate limit and any Auth call",
  );
});

Deno.test("nonce مكرر يوقف Auth وحدود المعدل بعد قرار PostgreSQL الذري", async () => {
  const events: string[] = [];
  const service = {
    rpc: async (name: string) => {
      events.push(name);
      return { data: false, error: null };
    },
    from: () => {
      throw new Error("replayed request must not read a profile");
    },
  };
  const response = await handleEmployeeLogin(
    await signedRequest("/functions/v1/employee-login", {
      employee_number: "00123",
      password: "correct",
    }, 11),
    {
      getEnv: (name) => BASE_ENV[name],
      createClient: (() => service) as any,
    },
  );
  assert(
    response.status === 401,
    "replayed signed login receives the same generic failure",
  );
  assert(
    events.length === 1 && events[0] === "consume_auth_ingress_replay",
    "replay rejection stops rate limits, profile lookup, and Auth",
  );
});
