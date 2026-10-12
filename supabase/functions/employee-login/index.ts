// employee-login — resolves a work number privately, then signs in without exposing email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  readBoundedJsonObject,
  verifiedAuthIngress,
} from "../_shared/auth-ingress.ts";

const GENERIC_LOGIN_ERROR =
  "بيانات تسجيل الدخول غير صحيحة أو المحاولة مقيّدة مؤقتاً.";
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const MAX_PASSWORD_LENGTH = 1024;

type EnvReader = (name: string) => string | undefined;
type SupabaseClientLike = any;

type EmployeeProfile = {
  id: string;
  email: string | null;
  auth_uid: string | null;
  is_active: boolean | null;
};

export type EmployeeLoginDependencies = {
  /** Injected only by local tests; production reads the Edge Function environment. */
  getEnv?: EnvReader;
  createClient?: (
    url: string,
    key: string,
    options: Record<string, unknown>,
  ) => SupabaseClientLike;
};

function environment(deps: EmployeeLoginDependencies): EnvReader {
  return deps.getEnv ?? ((name) => Deno.env.get(name));
}

function configuredOrigins(getEnv: EnvReader): Set<string> {
  // Deliberately no default/legacy domains: deployment must nominate every origin.
  const configured = getEnv("EMPLOYEE_LOGIN_ALLOWED_ORIGINS") ?? "";
  const origins = new Set<string>();
  for (const candidate of configured.split(",")) {
    const origin = candidate.trim();
    if (!origin) continue;
    try {
      const parsed = new URL(origin);
      if (parsed.origin === origin && parsed.protocol === "https:") {
        origins.add(origin);
      }
    } catch {
      // An invalid configured value is ignored; an empty valid set fails closed.
    }
  }
  return origins;
}

function originForRequest(
  req: Request,
  allowedOrigins: Set<string>,
): string | null {
  const origin = req.headers.get("origin")?.trim() ?? "";
  return origin && allowedOrigins.has(origin) ? origin : null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function respond(
  origin: string | null,
  body: Record<string, unknown>,
  status: number,
): Response {
  const headers = origin
    ? corsHeaders(origin)
    : { "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" };
  return new Response(JSON.stringify(body), { status, headers });
}

function loginFailure(origin: string | null, status = 401): Response {
  return respond(origin, { error: GENERIC_LOGIN_ERROR }, status);
}

/** Turns 123 and 00123 into one five-digit, rate-limit-safe identifier. */
export function normalizeEmployeeNumber(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(raw)) return null;
  return raw.replace(/^0+/, "").padStart(5, "0");
}

function employeeNumberCandidates(canonical: string): string[] {
  // Existing deployments can contain pre-canonical text values. These aliases
  // are lookup-only; every alias shares the single canonical rate-limit key.
  const unpadded = canonical.replace(/^0+/, "") || "0";
  return canonical === unpadded ? [canonical] : [canonical, unpadded];
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function employeeLoginRateKey(
  salt: string,
  scope: "ip" | "employee",
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`athar/employee-login/v1/${scope}/${value}`),
  );
  return toHex(signature);
}

async function consumeRateLimit(
  client: SupabaseClientLike,
  keyHash: string,
): Promise<boolean> {
  const { data, error } = await client.rpc(
    "consume_employee_login_rate_limit",
    {
      p_key_hash: keyHash,
    },
  );
  if (error) throw new Error("rate-limit-unavailable");
  return data === true;
}

async function consumeIngressReplay(
  client: SupabaseClientLike,
  nonceHash: string,
  expiresAt: number,
): Promise<boolean> {
  const { data, error } = await client.rpc("consume_auth_ingress_replay", {
    p_nonce_hash: nonceHash,
    p_expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  if (error || data !== true) return false;
  return true;
}

async function lookupEmployeeProfile(
  serviceClient: SupabaseClientLike,
  canonicalEmployeeNumber: string,
): Promise<EmployeeProfile | null> {
  const { data, error } = await serviceClient
    .from("users")
    .select("id,email,auth_uid,is_active")
    .in("employee_number", employeeNumberCandidates(canonicalEmployeeNumber))
    .eq("is_active", true);
  if (error) throw new Error("profile-lookup-failed");
  if (!Array.isArray(data) || data.length !== 1) return null;
  const profile = data[0] as EmployeeProfile;
  return profile?.id && profile.email ? profile : null;
}

async function revalidateSignedInProfile(
  serviceClient: SupabaseClientLike,
  profileId: string,
  authUid: string,
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from("users")
    .select("auth_uid,is_active")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error("profile-revalidation-failed");
  return data?.is_active === true && data?.auth_uid === authUid;
}

/**
 * Dependency-injected handler: local tests never instantiate production clients.
 * Deployment requirements: set EMPLOYEE_LOGIN_ALLOWED_ORIGINS and an independent
 * EMPLOYEE_LOGIN_RATE_LIMIT_SALT. Production should use AUTH_INGRESS_MODE=signed
 * with the HMAC Worker; legacy proxy mode remains an explicit compatibility path.
 */
export async function handleEmployeeLogin(
  req: Request,
  deps: EmployeeLoginDependencies = {},
): Promise<Response> {
  if (req.method !== "POST" && req.method !== "OPTIONS") {
    return respond(null, { error: "Method not allowed" }, 405);
  }

  const getEnv = environment(deps);
  const origin = originForRequest(req, configuredOrigins(getEnv));
  if (!origin) return respond(null, { error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const body = await readBoundedJsonObject(req, MAX_REQUEST_BODY_BYTES);
  if (!body) return loginFailure(origin, 400);
  const employeeNumber = normalizeEmployeeNumber(body.value.employee_number);
  const password = typeof body.value.password === "string"
    ? body.value.password
    : "";
  if (!employeeNumber || !password || password.length > MAX_PASSWORD_LENGTH) {
    return loginFailure(origin, 400);
  }

  const ingress = await verifiedAuthIngress(
    req,
    body.bytes,
    {
      expectedMethod: "POST",
      expectedPath: "/functions/v1/employee-login",
      getEnv,
    },
  );
  const supabaseUrl = getEnv("SUPABASE_URL") ?? "";
  const anonKey = getEnv("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const rateLimitSalt = getEnv("EMPLOYEE_LOGIN_RATE_LIMIT_SALT") ?? "";
  if (
    !ingress || !supabaseUrl || !anonKey || !serviceRoleKey ||
    rateLimitSalt.length < 32
  ) {
    return loginFailure(origin, 503);
  }

  const makeClient = deps.createClient ?? createClient;
  try {
    const clientIp = ingress.clientIp;
    const [ipKey, employeeKey] = await Promise.all([
      employeeLoginRateKey(rateLimitSalt, "ip", clientIp),
      employeeLoginRateKey(rateLimitSalt, "employee", employeeNumber),
    ]);
    const clientOptions = {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
    const serviceClient = makeClient(
      supabaseUrl,
      serviceRoleKey,
      clientOptions,
    );
    // Replay consumption is atomic in PostgreSQL and happens before any Auth
    // action or rate-limit mutation. Unsigned requests never reach this point.
    if (
      ingress.mode === "signed" &&
      !await consumeIngressReplay(
        serviceClient,
        ingress.replayNonceHash!,
        ingress.replayExpiresAt!,
      )
    ) return loginFailure(origin);
    const [ipAllowed, employeeAllowed] = await Promise.all([
      consumeRateLimit(serviceClient, ipKey),
      consumeRateLimit(serviceClient, employeeKey),
    ]);
    if (!ipAllowed || !employeeAllowed) return loginFailure(origin, 429);

    const profile = await lookupEmployeeProfile(serviceClient, employeeNumber);
    if (!profile?.email) return loginFailure(origin);

    const authClient = makeClient(supabaseUrl, anonKey, clientOptions);
    const { data: authData, error: authError } = await authClient.auth
      .signInWithPassword({
        email: profile.email,
        password,
      });
    const signedInAuthUid = authData?.user?.id;
    if (authError || !authData?.session || !signedInAuthUid) {
      return loginFailure(origin);
    }

    // The profile may have been disabled or rebound during sign-in. Do not leak
    // the session before rechecking the same row and Auth identity.
    if (
      !await revalidateSignedInProfile(
        serviceClient,
        profile.id,
        signedInAuthUid,
      )
    ) {
      return loginFailure(origin);
    }

    // Deliberately do not clear either counter on success. In particular, an
    // attacker must not be able to reset a shared IP's guess budget by signing
    // into a different valid account.
    return respond(origin, {
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      expires_in: authData.session.expires_in,
      expires_at: authData.session.expires_at,
      token_type: authData.session.token_type,
      rate_limit_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    }, 200);
  } catch {
    // Provider/database errors are intentionally indistinguishable from failure.
    return loginFailure(origin, 503);
  }
}

if (import.meta.main) Deno.serve((req) => handleEmployeeLogin(req));
