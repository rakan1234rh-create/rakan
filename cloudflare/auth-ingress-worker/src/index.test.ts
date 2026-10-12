import {
  AUTH_INGRESS_HEADER_PREFIX,
  bytesToBase64Url,
  verifiedAuthIngress,
} from "../../../supabase/functions/_shared/auth-ingress.ts";
import { AuthIngressWorkerEnv, handleAuthIngress } from "./index.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const SECRET = bytesToBase64Url(new Uint8Array(48).fill(11));
const ENV: AuthIngressWorkerEnv = {
  AUTH_INGRESS_HMAC_SECRET: SECRET,
  AUTH_INGRESS_ALLOWED_ORIGINS: "https://athar-app.online",
  SUPABASE_ANON_KEY: "public-anon-key-only",
};

function browserRequest(
  path = "/api/auth/employee-login",
  options: { method?: string; headers?: HeadersInit; body?: string } = {},
): Request {
  const method = options.method ?? "POST";
  return new Request(`https://ingress.example.test${path}`, {
    method,
    headers: {
      origin: "https://athar-app.online",
      "content-type": "application/json",
      "cf-connecting-ip": "2001:0db8::7",
      "cf-ray": "0123456789abcdef-JED",
      ...options.headers,
    },
    body: method === "GET" || method === "HEAD"
      ? undefined
      : options.body ?? '{"employee_number":"00123","password":"x"}',
  });
}

Deno.test("Worker permits only the two exact gateway paths and exact configured CORS origin", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return new Response("unexpected");
  };
  const unknown = await handleAuthIngress(
    browserRequest("/api/auth/anything"),
    ENV,
    fakeFetch,
  );
  assert(unknown.status === 404 && calls === 0, "no wildcard auth route");

  const foreign = await handleAuthIngress(
    browserRequest(undefined, {
      headers: { origin: "https://attacker.example" },
    }),
    ENV,
    fakeFetch,
  );
  assert(
    foreign.status === 403 && calls === 0,
    "foreign Origin cannot use signing proxy",
  );
  assert(
    foreign.headers.get("access-control-allow-origin") === null,
    "CORS never reflects foreign Origin",
  );

  const method = await handleAuthIngress(
    browserRequest(undefined, { method: "GET" }),
    ENV,
    fakeFetch,
  );
  assert(method.status === 405 && calls === 0, "GET never reaches upstream");
});

Deno.test("Worker handles preflight without signing or contacting the upstream", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return new Response("unexpected");
  };
  const preflight = await handleAuthIngress(
    browserRequest(undefined, {
      method: "OPTIONS",
      headers: {
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
      body: undefined,
    }),
    ENV,
    fakeFetch,
  );
  assert(
    preflight.status === 204 && calls === 0,
    "preflight must not mint a signature",
  );
  assert(
    preflight.headers.get("access-control-allow-origin") ===
      "https://athar-app.online",
    "preflight has exact CORS origin",
  );

  const malformed = await handleAuthIngress(
    browserRequest(undefined, {
      method: "OPTIONS",
      headers: {
        "access-control-request-headers": "content-type, authorization",
      },
      body: undefined,
    }),
    ENV,
    fakeFetch,
  );
  assert(
    malformed.status === 400 && calls === 0,
    "unneeded auth headers are not CORS-allowed",
  );
});

Deno.test("Worker bounds body/IP headers, strips caller signing material, and emits a verifiable upstream request", async () => {
  let captured: Request | null = null;
  const fakeFetch = async (input: RequestInfo | URL) => {
    captured = input as Request;
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: {
        "access-control-allow-origin": "https://attacker.example",
        "x-athar-ingress-signature": "must-not-return",
        "x-athar-ingress-future-internal": "must-not-return",
      },
    });
  };
  const response = await handleAuthIngress(
    browserRequest(undefined, {
      headers: {
        authorization: "Bearer untrusted",
        apikey: "untrusted-client-key",
        [`${AUTH_INGRESS_HEADER_PREFIX}signature`]: "untrusted",
        "x-forwarded-for": "203.0.113.10",
      },
    }),
    ENV,
    fakeFetch,
  );
  assert(response.status === 202 && captured, "valid gateway POST is proxied");
  // Assignment through fakeFetch is intentionally opaque to TypeScript's
  // control-flow engine; the assertion above establishes this runtime cast.
  const outbound = captured as unknown as Request;
  assert(
    outbound.url ===
      "https://cmdkldxbocbpiptdodmp.supabase.co/functions/v1/employee-login",
    "fixed project upstream",
  );
  assert(
    outbound.headers.get("authorization") === null,
    "caller Authorization is stripped",
  );
  assert(
    outbound.headers.get("apikey") === ENV.SUPABASE_ANON_KEY,
    "Worker sets its configured public key",
  );
  assert(
    outbound.headers.get("x-forwarded-for") === null,
    "caller proxy headers are stripped",
  );
  assert(
    outbound.headers.get(`${AUTH_INGRESS_HEADER_PREFIX}signature`) !==
      "untrusted",
    "caller signature is replaced",
  );
  assert(
    response.headers.get("x-athar-ingress-signature") === null,
    "Worker never exposes ingress signature",
  );
  assert(
    response.headers.get("x-athar-ingress-future-internal") === null,
    "Worker never exposes future ingress-internal headers",
  );
  assert(
    response.headers.get("access-control-allow-origin") ===
      "https://athar-app.online",
    "upstream CORS is overwritten",
  );

  const outboundBody = new Uint8Array(await outbound.clone().arrayBuffer());
  const verified = await verifiedAuthIngress(outbound, outboundBody, {
    expectedMethod: "POST",
    expectedPath: "/functions/v1/employee-login",
    getEnv: (name) =>
      name === "AUTH_INGRESS_MODE"
        ? "signed"
        : name === "AUTH_INGRESS_HMAC_SECRET"
        ? SECRET
        : undefined,
  });
  assert(
    verified?.clientIp === "2001:db8::7",
    "signature includes canonical CF ingress IP",
  );

  const overLimit = await handleAuthIngress(
    browserRequest(undefined, {
      body: "x".repeat(4097),
    }),
    ENV,
    fakeFetch,
  );
  assert(
    overLimit.status === 400,
    "worker enforces employee-login byte cap before fetch",
  );

  const ambiguousIp = await handleAuthIngress(
    browserRequest(undefined, {
      headers: { "cf-connecting-ip": "198.51.100.1, 203.0.113.1" },
    }),
    ENV,
    fakeFetch,
  );
  assert(ambiguousIp.status === 400, "ambiguous Cloudflare IP fails closed");

  const workerSubrequest = await handleAuthIngress(
    browserRequest(undefined, {
      headers: { "cf-worker": "athar-app.online" },
    }),
    ENV,
    fakeFetch,
  );
  assert(
    workerSubrequest.status === 400,
    "Worker subrequests cannot mint a client-IP signature",
  );
});
