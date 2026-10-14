import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  readBoundedJsonObject,
  decodeAuthIngressSecret,
  verifiedAuthIngress,
} from "../_shared/auth-ingress.ts";
import {
  canIssueRecovery,
  hasUsableRecoveryRateLimitSalt,
  isRecoveryEmail,
  normalizeRecoveryEmail,
  recoveryCounterHash,
} from "./_shared.ts";

const DEFAULT_ORIGIN = "https://athar-app.online";
const RESEND_AFTER_SECONDS = 60;
const MAX_BODY_BYTES = 2048;

export type RecoveryDependencies = {
  getEnv?: (name: string) => string | undefined;
  createClient?: typeof createClient;
};

type RateLimitDecision = {
  allowed: boolean;
  retry_after_seconds: number;
};

function diagnostic(stage: string, details: Record<string, unknown> = {}): void {
  // Safe diagnostics only: never include secrets, email addresses, IPs, bodies,
  // signatures, nonces, or provider error messages.
  console.error(JSON.stringify({
    event: "password_recovery_diagnostic",
    stage,
    ...details,
  }));
}

async function secretFingerprintPrefix(
  secret: Uint8Array | null,
): Promise<string | null> {
  if (!secret) return null;
  const copy = new Uint8Array(secret.byteLength);
  copy.set(secret);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("").slice(0, 8);
}

function allowedOrigins(
  getEnv: (name: string) => string | undefined,
): Set<string> {
  const origins = new Set<string>();
  // PASSWORD_RECOVERY_ALLOWED_ORIGINS narrows this endpoint independently.
  // ALLOWED_ORIGIN remains an exact-origin compatibility setting for the
  // existing recovery deployment; neither setting permits a wildcard/default.
  const configured = getEnv("PASSWORD_RECOVERY_ALLOWED_ORIGINS") ??
    getEnv("ALLOWED_ORIGIN") ?? "";
  for (const candidate of configured.split(",")) {
    const origin = candidate.trim();
    if (!origin) continue;
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:" && parsed.origin === origin) {
        origins.add(origin);
      }
    } catch {
      // An invalid setting cannot accidentally reflect a caller-controlled Origin.
    }
  }
  return origins;
}

function originForRequest(
  req: Request,
  getEnv: (name: string) => string | undefined,
): string | null {
  const origin = req.headers.get("origin")?.trim() ?? "";
  return origin && allowedOrigins(getEnv).has(origin) ? origin : null;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string | null, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(origin ? corsHeaders(origin) : { "Vary": "Origin" }),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function asRateDecision(value: unknown): RateLimitDecision | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const candidate = row as Record<string, unknown>;
  if (typeof candidate.allowed !== "boolean") return null;
  const retry = Math.max(
    0,
    Math.ceil(Number(candidate.retry_after_seconds) || 0),
  );
  return { allowed: candidate.allowed, retry_after_seconds: retry };
}

async function parseBody(
  req: Request,
): Promise<{ email: string; bytes: Uint8Array } | null> {
  const body = await readBoundedJsonObject(req, MAX_BODY_BYTES);
  const email = normalizeRecoveryEmail(body?.value.email);
  return body && isRecoveryEmail(email) ? { email, bytes: body.bytes } : null;
}

async function consumeIngressReplay(
  client: any,
  nonceHash: string,
  expiresAt: number,
): Promise<boolean> {
  const { data, error } = await client.rpc("consume_auth_ingress_replay", {
    p_nonce_hash: nonceHash,
    p_expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  return !error && data === true;
}

export async function handlePasswordRecovery(
  req: Request,
  deps: RecoveryDependencies = {},
): Promise<Response> {
  const getEnv = deps.getEnv ?? ((name: string) => Deno.env.get(name));
  const makeClient = deps.createClient ?? createClient;
  const origin = originForRequest(req, getEnv);
  if (req.method === "OPTIONS") {
    return origin
      ? new Response(null, { status: 204, headers: corsHeaders(origin) })
      : json(null, { error: "forbidden" }, 403);
  }
  if (req.method !== "POST") {
    return json(origin, { error: "method_not_allowed" }, 405);
  }
  if (!origin) {
    diagnostic("origin_rejected");
    return json(null, { error: "forbidden" }, 403);
  }

  const payload = await parseBody(req);
  if (!payload) {
    diagnostic("body_rejected");
    return json(origin, { error: "invalid_request" }, 400);
  }

  const ingress = await verifiedAuthIngress(
    req,
    payload.bytes,
    {
      expectedMethod: "POST",
      expectedPath: "/functions/v1/password-recovery",
      getEnv,
    },
  );
  if (!ingress) {
    const configuredSecret = decodeAuthIngressSecret(
      getEnv("AUTH_INGRESS_HMAC_SECRET"),
    );
    diagnostic("ingress_verification_failed", {
      mode: getEnv("AUTH_INGRESS_MODE") ?? "unset",
      hmac_present: Boolean(getEnv("AUTH_INGRESS_HMAC_SECRET")),
      hmac_valid_format: Boolean(configuredSecret),
      hmac_fingerprint_prefix: await secretFingerprintPrefix(configuredSecret),
    });
    return json(origin, { error: "recovery_temporarily_unavailable" }, 503);
  }

  const url = getEnv("SUPABASE_URL") || "";
  const anonKey = getEnv("SUPABASE_PUBLISHABLE_KEY") ||
    getEnv("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = getEnv("SUPABASE_SECRET_KEY") ||
    getEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
  const counterSalt = getEnv("PASSWORD_RECOVERY_RATE_LIMIT_SALT") || "";
  diagnostic("config_checked", {
    url_present: Boolean(url),
    publishable_key_present: Boolean(anonKey),
    service_key_present: Boolean(serviceRoleKey),
    rate_salt_present: Boolean(counterSalt),
    rate_salt_bytes: new TextEncoder().encode(counterSalt).byteLength,
  });
  if (
    !url || !anonKey || !serviceRoleKey ||
    !hasUsableRecoveryRateLimitSalt(counterSalt)
  ) {
    diagnostic("required_config_missing_or_invalid");
    return json(origin, { error: "recovery_temporarily_unavailable" }, 503);
  }

  const [emailKeyHash, ipKeyHash] = await Promise.all([
    recoveryCounterHash(counterSalt, "email", payload.email),
    recoveryCounterHash(counterSalt, "ip", ingress.clientIp),
  ]);
  const serviceClient = makeClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // PostgreSQL consumes the nonce atomically before counters, profile reads, or
  // resetPasswordForEmail. Bad signed configuration/unsigned requests returned
  // above without constructing this privileged client.
  if (
    ingress.mode === "signed" &&
    !await consumeIngressReplay(
      serviceClient,
      ingress.replayNonceHash!,
      ingress.replayExpiresAt!,
    )
  ) {
    diagnostic("replay_rpc_rejected");
    return json(origin, { error: "recovery_temporarily_unavailable" }, 503);
  }

  // RPC خادمي فقط؛ يزيد الحدين في معاملة واحدة ولا يعيد قيمة العدادات.
  const { data: limitData, error: limitError } = await serviceClient.rpc(
    "consume_password_recovery_rate_limit",
    { p_email_key_hash: emailKeyHash, p_ip_key_hash: ipKeyHash },
  );
  const limit = asRateDecision(limitData);
  if (limitError || !limit) {
    diagnostic("rate_limit_rpc_failed", {
      error_code: limitError?.code ?? null,
      result_shape_valid: Boolean(limit),
    });
    return json(origin, { error: "recovery_temporarily_unavailable" }, 503);
  }
  if (!limit.allowed) {
    return json(origin, {
      error: "try_later",
      retry_after_seconds: Math.max(1, limit.retry_after_seconds),
    }, 429);
  }

  // خدمة Role تقرأ الحد الأدنى فقط. النتيجة لا تغيّر الاستجابة لمنع تعداد الحسابات.
  const { data: profile, error: profileError } = await serviceClient
    .from("users")
    .select("auth_uid, is_active")
    .eq("email", payload.email)
    .maybeSingle();
  if (profileError) {
    diagnostic("profile_lookup_failed", {
      error_code: profileError.code ?? null,
    });
    return json(origin, { error: "recovery_temporarily_unavailable" }, 503);
  }

  if (canIssueRecovery(profile)) {
    // نسلك Auth العادي بالمفتاح المنشور، فلا نتجاوز حدود Auth/SMTP الطبيعية.
    const authClient = makeClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const redirectTo = getEnv("PASSWORD_RECOVERY_REDIRECT_URL") ||
      `${DEFAULT_ORIGIN}/#reset-password`;
    const { error: authError } = await authClient.auth.resetPasswordForEmail(
      payload.email,
      {
        redirectTo,
      },
    );
    if (authError) {
      const status = Number(authError.status || 0);
      diagnostic("auth_recovery_call_failed", {
        provider_status: Number.isFinite(status) ? status : 0,
      });
      if (status === 429) {
        return json(origin, {
          error: "try_later",
          retry_after_seconds: RESEND_AFTER_SECONDS,
        }, 429);
      }
      return json(origin, { error: "recovery_temporarily_unavailable" }, 503);
    }
  }

  // نفس الرد للحساب النشط وغير النشط وغير الموجود؛ لا بريد/OTP/سر في الرد أو السجل.
  return json(origin, {
    accepted: true,
    resend_after_seconds: RESEND_AFTER_SECONDS,
  }, 202);
}

if (import.meta.main) {
  Deno.serve((req) =>
    handlePasswordRecovery(req).catch(() => (
      diagnostic("unhandled_exception"),
      json(null, { error: "recovery_temporarily_unavailable" }, 503)
    ))
  );
}
