import {
  AUTH_INGRESS_HEADER_PREFIX,
  AUTH_INGRESS_VERSION,
  authIngressCanonicalMessage,
  authIngressSignature,
  bytesToBase64Url,
  decodeAuthIngressSecret,
  sha256Hex,
  verifiedAuthIngress,
} from "./auth-ingress.ts";
import { normalizedClientIp } from "./client-ip.ts";

const app = await Deno.readTextFile(
  new URL("../../../js/app.js", import.meta.url),
);
const appIngressConfig = await Deno.readTextFile(
  new URL("../../../js/auth-ingress-config.js", import.meta.url),
);

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const NOW = 1_700_000_000;
const SECRET = bytesToBase64Url(new Uint8Array(48).fill(7));
const secretBytes = decodeAuthIngressSecret(SECRET)!;
const ENV: Record<string, string> = {
  AUTH_INGRESS_MODE: "signed",
  AUTH_INGRESS_HMAC_SECRET: SECRET,
};
const getEnv = (name: string) => ENV[name];
const PATH = "/functions/v1/employee-login";

type SignedRequestOptions = {
  body?: string;
  path?: string;
  requestPath?: string;
  method?: string;
  timestamp?: number;
  ip?: string;
  mutateHeaders?: (headers: Headers) => void;
};

async function signedRequest(
  options: SignedRequestOptions = {},
): Promise<Request> {
  const body = options.body ?? '{"employee_number":"00123","password":"x"}';
  const path = options.path ?? PATH;
  const timestamp = String(options.timestamp ?? NOW);
  const nonce = bytesToBase64Url(new Uint8Array(24).fill(9));
  const ip = options.ip ?? "198.51.100.44";
  const canonicalIp = normalizedClientIp(ip) ?? ip;
  const bodySha256 = await sha256Hex(new TextEncoder().encode(body));
  const signature = await authIngressSignature(
    secretBytes,
    authIngressCanonicalMessage({
      method: "POST",
      path,
      timestamp,
      nonce,
      clientIp: canonicalIp,
      bodySha256,
    }),
  );
  const headers = new Headers({
    [`${AUTH_INGRESS_HEADER_PREFIX}version`]: AUTH_INGRESS_VERSION,
    [`${AUTH_INGRESS_HEADER_PREFIX}timestamp`]: timestamp,
    [`${AUTH_INGRESS_HEADER_PREFIX}nonce`]: nonce,
    [`${AUTH_INGRESS_HEADER_PREFIX}ip`]: ip,
    [`${AUTH_INGRESS_HEADER_PREFIX}body-sha256`]: bodySha256,
    [`${AUTH_INGRESS_HEADER_PREFIX}method`]: "POST",
    [`${AUTH_INGRESS_HEADER_PREFIX}path`]: path,
    [`${AUTH_INGRESS_HEADER_PREFIX}signature`]: signature,
  });
  options.mutateHeaders?.(headers);
  return new Request(
    `https://edge.example.test${options.requestPath ?? PATH}`,
    {
      method: options.method ?? "POST",
      headers,
      body: options.method === "GET" ? undefined : body,
    },
  );
}

async function verify(req: Request) {
  const bytes = new Uint8Array(await req.clone().arrayBuffer());
  return await verifiedAuthIngress(req, bytes, {
    expectedMethod: "POST",
    expectedPath: PATH,
    getEnv,
    nowSeconds: NOW,
  });
}

Deno.test("signed ingress accepts cryptographically valid normalized IPv4 and IPv6 only", async () => {
  for (
    const [ip, expected] of [
      ["198.051.100.044", "198.51.100.44"],
      ["2001:0db8::0044", "2001:db8::44"],
    ]
  ) {
    const result = await verify(await signedRequest({ ip }));
    assert(result?.mode === "signed", "valid HMAC request accepted");
    assert(result.clientIp === expected, `canonical IP must be ${expected}`);
    assert(
      /^[a-f0-9]{64}$/.test(result.replayNonceHash ?? ""),
      "nonce hash is not raw nonce",
    );
  }
});

Deno.test("signed ingress rejects forged, missing, expired, future, and duplicate fields", async () => {
  const cases: Array<[string, SignedRequestOptions]> = [
    ["forged signature", {
      mutateHeaders: (headers) =>
        headers.set(`${AUTH_INGRESS_HEADER_PREFIX}signature`, "A".repeat(43)),
    }],
    ["missing nonce", {
      mutateHeaders: (headers) =>
        headers.delete(`${AUTH_INGRESS_HEADER_PREFIX}nonce`),
    }],
    ["expired timestamp", { timestamp: NOW - 61 }],
    ["future timestamp", { timestamp: NOW + 11 }],
    ["unknown signed field", {
      mutateHeaders: (headers) =>
        headers.set(`${AUTH_INGRESS_HEADER_PREFIX}extra`, "x"),
    }],
    ["duplicate folded nonce", {
      mutateHeaders: (headers) =>
        headers.append(`${AUTH_INGRESS_HEADER_PREFIX}nonce`, "other"),
    }],
    ["malformed IP", { ip: "198.51.100.44, 203.0.113.1" }],
  ];
  for (const [label, options] of cases) {
    assert(
      await verify(await signedRequest(options)) === null,
      `${label} must fail closed`,
    );
  }
});

Deno.test("signed ingress binds the exact raw body, Edge path, and POST method", async () => {
  const bodyTampered = await signedRequest({
    body: '{"employee_number":"00123","password":"changed"}',
  });
  // Sign a different body and transplant those fields to model a body swap.
  const original = await signedRequest();
  const tamperedHeaders = new Headers(original.headers);
  const differentBody = new Request(bodyTampered.url, {
    method: "POST",
    headers: tamperedHeaders,
    body: await bodyTampered.text(),
  });
  assert(
    await verify(differentBody) === null,
    "body hash/signature mismatch rejects",
  );
  assert(
    await verify(
      await signedRequest({ path: "/functions/v1/password-recovery" }),
    ) === null,
    "signed path mismatch rejects",
  );
  assert(
    await verify(
      await signedRequest({ requestPath: "/functions/v1/password-recovery" }),
    ) === null,
    "actual Edge path mismatch rejects",
  );
  assert(
    await verify(await signedRequest({ method: "GET" })) === null,
    "method change rejects",
  );
});

Deno.test("the same signed nonce has a stable replay key for atomic database consumption", async () => {
  const first = await verify(await signedRequest());
  const second = await verify(await signedRequest());
  assert(
    first?.replayNonceHash === second?.replayNonceHash,
    "same nonce maps to one replay row",
  );
  assert(
    first?.replayExpiresAt === NOW + 120,
    "replay expiry is bounded from signed time",
  );
  // The database RPC test covers the required atomic first-consumer-wins behavior.
});

Deno.test("signed mode never silently falls back to legacy proxy headers", async () => {
  const previous = ENV.AUTH_INGRESS_HMAC_SECRET;
  ENV.AUTH_INGRESS_HMAC_SECRET = "invalid";
  const req = await signedRequest();
  assert(
    await verify(req) === null,
    "missing/bad signed secret must not use CF/XFF",
  );
  ENV.AUTH_INGRESS_HMAC_SECRET = previous;
});

Deno.test("الواجهة لا تستخدم البوابة قبل ضبط عنوانها ولا تمرر مفتاح المتصفح إليها", () => {
  assert(
    appIngressConfig.includes('window.ATHAR_AUTH_INGRESS_BASE_URL = ""'),
    "الإعداد الافتراضي لا يوجه المستخدمين إلى بوابة غير منشورة",
  );
  assert(
    app.includes("const EMPLOYEE_LOGIN_ENDPOINT = authEndpoint(") &&
      app.includes("const PASSWORD_RECOVERY_ENDPOINT = authEndpoint("),
    "مسارا الدخول والاستعادة يتحولان صراحة إلى Worker عند ضبطه",
  );
  assert(
    app.includes("viaIngress ? {} : { apikey: SUPABASE_ANON }"),
    "مفتاح المتصفح لا يمرر إلى Worker؛ Worker يضع مفتاح المشروع من إعداده",
  );
});
