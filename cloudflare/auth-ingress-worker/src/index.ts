import {
  AUTH_INGRESS_HEADER_PREFIX,
  AUTH_INGRESS_VERSION,
  authIngressCanonicalMessage,
  authIngressSignature,
  decodeAuthIngressSecret,
  randomAuthIngressNonce,
  sha256Hex,
} from "../../../supabase/functions/_shared/auth-ingress.ts";
import { normalizedClientIp } from "../../../supabase/functions/_shared/client-ip.ts";

const UPSTREAM_ORIGIN = "https://cmdkldxbocbpiptdodmp.supabase.co";
const MAX_CORS_HEADER_BYTES = 256;

const ROUTES: Record<string, { upstreamPath: string; maxBodyBytes: number }> = {
  "/api/auth/employee-login": {
    upstreamPath: "/functions/v1/employee-login",
    maxBodyBytes: 4 * 1024,
  },
  "/api/auth/password-recovery": {
    upstreamPath: "/functions/v1/password-recovery",
    maxBodyBytes: 2 * 1024,
  },
};

export type AuthIngressWorkerEnv = {
  /** Base64url, no padding, decoding to at least 32 random bytes. Secret binding. */
  AUTH_INGRESS_HMAC_SECRET?: string;
  /** Comma-separated exact HTTPS origins; a non-secret Worker variable. */
  AUTH_INGRESS_ALLOWED_ORIGINS?: string;
  /** Supabase publishable/anon key. It is set by the Worker, not trusted from clients. */
  SUPABASE_ANON_KEY?: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function exactHttpsOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const candidate of (value ?? "").split(",")) {
    const origin = candidate.trim();
    if (!origin) continue;
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:" && parsed.origin === origin) {
        origins.add(origin);
      }
    } catch {
      // Invalid deployment configuration does not widen CORS.
    }
  }
  return origins;
}

function requestedOrigin(
  req: Request,
  env: AuthIngressWorkerEnv,
): string | null {
  const origin = req.headers.get("origin")?.trim() ?? "";
  return origin &&
    exactHttpsOrigins(env.AUTH_INGRESS_ALLOWED_ORIGINS).has(origin)
    ? origin
    : null;
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  });
}

function errorResponse(
  origin: string | null,
  status: number,
  error: string,
): Response {
  const headers = origin
    ? corsHeaders(origin)
    : new Headers({
        "Content-Type": "application/json; charset=utf-8",
        Vary: "Origin",
      });
  return new Response(JSON.stringify({ error }), { status, headers });
}

function oneHeader(
  req: Request,
  name: string,
  maxBytes: number,
): string | null {
  const value = req.headers.get(name);
  // Fetch combines duplicate request headers with commas. Treat an ambiguity as
  // absent rather than trying to choose which attacker-controlled value won.
  if (
    !value ||
    value.length > maxBytes ||
    value.includes(",") ||
    /[\r\n\x00]/.test(value)
  ) {
    return null;
  }
  return value;
}

function workerClientIp(req: Request): string | null {
  // Same-zone Worker subrequests can alter x-real-ip, from which Cloudflare
  // derives CF-Connecting-IP. This Worker signs only a browser-to-Worker hop;
  // any request already marked as a Worker subrequest fails closed.
  if (req.headers.has("cf-worker")) return null;
  const candidate = oneHeader(req, "cf-connecting-ip", 64);
  if (!candidate) return null;
  const ip = normalizedClientIp(candidate);
  // The client IP is supplied by Cloudflare. Do not blacklist a hard-coded
  // address: Apple Private Relay and carrier proxies can legitimately reuse
  // Cloudflare egress ranges. Worker-to-Worker requests are rejected above
  // using the cf-worker marker, and the signed ingress plus rate limits remain
  // the security boundary.
  if (!ip) return null;

  // CF-Ray is added by Cloudflare to a client request reaching this Worker. It
  // does not prove user identity, but its absence signals a nonstandard or
  // ambiguous invocation, which fails closed rather than signing a supplied IP.
  const ray = oneHeader(req, "cf-ray", 80);
  if (!ray || !/^[a-f0-9]{16,32}-[a-z]{3,5}$/i.test(ray)) return null;
  return ip;
}

function validContentLength(req: Request, maxBodyBytes: number): boolean {
  const value = req.headers.get("content-length");
  return !value || (/^\d{1,8}$/.test(value) && Number(value) <= maxBodyBytes);
}

async function readBoundedBody(
  req: Request,
  maxBodyBytes: number,
): Promise<Uint8Array | null> {
  if (!validContentLength(req, maxBodyBytes)) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validPreflight(req: Request): boolean {
  const requestedMethod = req.headers.get("access-control-request-method");
  const requestedHeaders = req.headers.get("access-control-request-headers");
  if (requestedMethod && requestedMethod.toUpperCase() !== "POST") return false;
  if (!requestedHeaders) return true;
  if (requestedHeaders.length > MAX_CORS_HEADER_BYTES) return false;
  return requestedHeaders
    .split(",")
    .every((header) => header.trim().toLowerCase() === "content-type");
}

function upstreamResponse(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  for (const name of [
    "access-control-allow-origin",
    "access-control-allow-headers",
    "access-control-allow-methods",
    "access-control-max-age",
  ])
    headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith(AUTH_INGRESS_HEADER_PREFIX)) {
      headers.delete(name);
    }
  }
  for (const [name, value] of corsHeaders(origin)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * This is deliberately a one-way proxy, not a signing API. It never exposes a
 * signature/nonce/secret in its own responses and never logs headers or body.
 */
export async function handleAuthIngress(
  req: Request,
  env: AuthIngressWorkerEnv,
  doFetch: FetchLike = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const route = ROUTES[url.pathname];
  if (!route) return errorResponse(null, 404, "not_found");

  const origin = requestedOrigin(req, env);
  if (!origin) return errorResponse(null, 403, "origin_not_allowed");
  if (req.method === "OPTIONS") {
    return validPreflight(req)
      ? new Response(null, { status: 204, headers: corsHeaders(origin) })
      : errorResponse(origin, 400, "invalid_preflight");
  }
  if (req.method !== "POST") {
    return errorResponse(origin, 405, "method_not_allowed");
  }

  const secret = decodeAuthIngressSecret(env.AUTH_INGRESS_HMAC_SECRET);
  if (!secret || !env.SUPABASE_ANON_KEY) {
    return errorResponse(origin, 503, "ingress_unavailable");
  }
  const clientIp = workerClientIp(req);
  const body = await readBoundedBody(req, route.maxBodyBytes);
  if (!clientIp || !body) return errorResponse(origin, 400, "invalid_request");

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomAuthIngressNonce();
  const bodySha256 = await sha256Hex(body);
  const canonicalMessage = authIngressCanonicalMessage({
    method: "POST",
    path: route.upstreamPath,
    timestamp,
    nonce,
    clientIp,
    bodySha256,
  });
  const signature = await authIngressSignature(secret, canonicalMessage);

  // Build an allowlisted header set from scratch. In particular, a browser can
  // never select signed values or an upstream API key by supplying duplicates.
  const headers = new Headers({
    // The two allowlisted endpoints accept JSON only. Do not copy a caller's
    // arbitrary content type to a privileged upstream request.
    "content-type": "application/json; charset=utf-8",
    origin: origin,
    apikey: env.SUPABASE_ANON_KEY,
    [`${AUTH_INGRESS_HEADER_PREFIX}version`]: AUTH_INGRESS_VERSION,
    [`${AUTH_INGRESS_HEADER_PREFIX}timestamp`]: timestamp,
    [`${AUTH_INGRESS_HEADER_PREFIX}nonce`]: nonce,
    [`${AUTH_INGRESS_HEADER_PREFIX}ip`]: clientIp,
    [`${AUTH_INGRESS_HEADER_PREFIX}body-sha256`]: bodySha256,
    [`${AUTH_INGRESS_HEADER_PREFIX}method`]: "POST",
    [`${AUTH_INGRESS_HEADER_PREFIX}path`]: route.upstreamPath,
    [`${AUTH_INGRESS_HEADER_PREFIX}signature`]: signature,
  });
  try {
    return upstreamResponse(
      await doFetch(
        new Request(`${UPSTREAM_ORIGIN}${route.upstreamPath}`, {
          method: "POST",
          headers,
          body: (() => {
            const copy = new Uint8Array(body.byteLength);
            copy.set(body);
            return copy.buffer;
          })(),
          redirect: "manual",
        }),
      ),
      origin,
    );
  } catch {
    return errorResponse(origin, 503, "ingress_unavailable");
  }
}

export default {
  fetch(request: Request, env: AuthIngressWorkerEnv): Promise<Response> {
    return handleAuthIngress(request, env);
  },
};
