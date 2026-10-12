import { handlePasswordRecovery, RecoveryDependencies } from "./index.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const env: Record<string, string> = {
  ALLOWED_ORIGIN: "https://athar-app.online",
  AUTH_PROXY_IP_VERIFIED: "true",
  SUPABASE_URL: "https://test.invalid",
  SUPABASE_ANON_KEY: "test-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  PASSWORD_RECOVERY_RATE_LIMIT_SALT: "local-mock-only-32-or-more-random-bytes",
};
function request(): Request {
  return new Request("https://test.invalid", {
    method: "POST",
    headers: {
      origin: "https://athar-app.online",
      "cf-connecting-ip": "198.51.100.5",
      "x-forwarded-for": "198.51.100.5",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "employee@example.test" }),
  });
}
Deno.test("recovery happy-path, disabled and missing accounts use a uniform response without real mail", async () => {
  for (
    const profile of [{ auth_uid: "test-auth", is_active: true }, {
      auth_uid: "test-auth",
      is_active: false,
    }, null]
  ) {
    let sends = 0;
    const service = {
      rpc: () =>
        Promise.resolve({
          data: [{ allowed: true, retry_after_seconds: 0 }],
          error: null,
        }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: profile, error: null }),
          }),
        }),
      }),
    };
    const auth = {
      auth: {
        resetPasswordForEmail: () => {
          sends++;
          return Promise.resolve({ error: null });
        },
      },
    };
    const deps: RecoveryDependencies = {
      getEnv: (name) => env[name],
      createClient: ((_url: string, key: string) =>
        key === env.SUPABASE_SERVICE_ROLE_KEY
          ? service
          : auth) as unknown as RecoveryDependencies["createClient"],
    };
    const response = await handlePasswordRecovery(request(), deps);
    assert(response.status === 202, "same HTTP result");
    const payload = await response.json();
    assert(
      payload.accepted === true && !payload.email && !payload.otp,
      "no account/token disclosure",
    );
    assert(
      sends === (profile?.is_active ? 1 : 0),
      "only active bound account gets a mock request",
    );
  }
});
Deno.test("recovery rate rejection stops before account lookup or provider", async () => {
  const deps: RecoveryDependencies = {
    getEnv: (name) => env[name],
    createClient: (() => ({
      rpc: () =>
        Promise.resolve({
          data: [{ allowed: false, retry_after_seconds: 42 }],
          error: null,
        }),
      from: () => {
        throw new Error("must not look up account");
      },
    })) as unknown as RecoveryDependencies["createClient"],
  };
  const response = await handlePasswordRecovery(request(), deps);
  assert(response.status === 429, "rate rejection");
  assert(
    (await response.json()).retry_after_seconds === 42,
    "returns server wait, not a guessed minute",
  );
});
