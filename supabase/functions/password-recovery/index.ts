import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canIssueRecovery,
  hasUsableRecoveryRateLimitSalt,
  isRecoveryEmail,
  normalizeRecoveryEmail,
  recoveryCounterHash,
  verifiedRecoveryClientIp,
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

function allowedOrigins(getEnv = Deno.env.get): Set<string> {
  const configured = getEnv("ALLOWED_ORIGIN") || DEFAULT_ORIGIN;
  return new Set(
    configured.split(",").map((origin) => origin.trim()).filter(Boolean),
  );
}

function requestOriginIsAllowed(req: Request): boolean {
  return allowedOrigins().has(req.headers.get("origin") || "");
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": requestOriginIsAllowed(req) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
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

async function parseBody(req: Request): Promise<{ email: string } | null> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) return null;

  const reader = req.body?.getReader();
  if (!reader) return null;

  try {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const raw = new TextDecoder().decode(
      Uint8Array.from(chunks.flatMap((chunk) => [...chunk])),
    );
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const email = normalizeRecoveryEmail(
      (body as Record<string, unknown>).email,
    );
    return isRecoveryEmail(email) ? { email } : null;
  } catch (_) {
    return null;
  }
}

export async function handlePasswordRecovery(
  req: Request,
  deps: RecoveryDependencies = {},
): Promise<Response> {
  const getEnv = deps.getEnv ?? ((name: string) => Deno.env.get(name));
  const makeClient = deps.createClient ?? createClient;
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "method_not_allowed" }, 405);
  }
  if (!allowedOrigins(getEnv).has(req.headers.get("origin") || "")) {
    return json(req, { error: "forbidden" }, 403);
  }

  const payload = await parseBody(req);
  if (!payload) return json(req, { error: "invalid_request" }, 400);

  // لا يوجد مصدر IP مثبت في Edge Runtime لهذا النشر بعد؛ الفشل مغلق.
  const clientIp = verifiedRecoveryClientIp(
    req,
    getEnv("AUTH_PROXY_IP_VERIFIED") === "true",
  );
  if (!clientIp) {
    return json(req, { error: "recovery_temporarily_unavailable" }, 503);
  }

  const url = getEnv("SUPABASE_URL") || "";
  const anonKey = getEnv("SUPABASE_PUBLISHABLE_KEY") ||
    getEnv("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = getEnv("SUPABASE_SECRET_KEY") ||
    getEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
  const counterSalt = getEnv("PASSWORD_RECOVERY_RATE_LIMIT_SALT") || "";
  if (
    !url || !anonKey || !serviceRoleKey ||
    !hasUsableRecoveryRateLimitSalt(counterSalt)
  ) {
    return json(req, { error: "recovery_temporarily_unavailable" }, 503);
  }

  const [emailKeyHash, ipKeyHash] = await Promise.all([
    recoveryCounterHash(counterSalt, "email", payload.email),
    recoveryCounterHash(counterSalt, "ip", clientIp),
  ]);
  const serviceClient = makeClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // RPC خادمي فقط؛ يزيد الحدين في معاملة واحدة ولا يعيد قيمة العدادات.
  const { data: limitData, error: limitError } = await serviceClient.rpc(
    "consume_password_recovery_rate_limit",
    { p_email_key_hash: emailKeyHash, p_ip_key_hash: ipKeyHash },
  );
  const limit = asRateDecision(limitData);
  if (limitError || !limit) {
    return json(req, { error: "recovery_temporarily_unavailable" }, 503);
  }
  if (!limit.allowed) {
    return json(req, {
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
    return json(req, { error: "recovery_temporarily_unavailable" }, 503);
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
      if (status === 429) {
        return json(req, {
          error: "try_later",
          retry_after_seconds: RESEND_AFTER_SECONDS,
        }, 429);
      }
      return json(req, { error: "recovery_temporarily_unavailable" }, 503);
    }
  }

  // نفس الرد للحساب النشط وغير النشط وغير الموجود؛ لا بريد/OTP/سر في الرد أو السجل.
  return json(req, {
    accepted: true,
    resend_after_seconds: RESEND_AFTER_SECONDS,
  }, 202);
}

if (import.meta.main) {
  Deno.serve((req) =>
    handlePasswordRecovery(req).catch(() => (
      json(req, { error: "recovery_temporarily_unavailable" }, 503)
    ))
  );
}
