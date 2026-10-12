import { verifiedManagedClientIp } from "../_shared/client-ip.ts";

export type RecoveryProfile = {
  auth_uid: string | null;
  is_active: boolean | null;
};

export const MIN_RECOVERY_RATE_LIMIT_SALT_BYTES = 32;

export function normalizeRecoveryEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isRecoveryEmail(value: string): boolean {
  return value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * لا تثبت الرؤوس مصدرها وحدها. لا يفتح المسار إلا بعد مراجعة ingress وتفعيل
 * شرط النشر المشترك؛ غياب الشرط أو تعارض الرؤوس يؤدي إلى رفض مغلق.
 */
export function verifiedRecoveryClientIp(
  req: Request,
  ingressVerified = Deno.env.get("AUTH_PROXY_IP_VERIFIED") === "true",
): string | null {
  return verifiedManagedClientIp(
    req,
    ingressVerified,
  );
}

/** لا نقيّد الاستعادة بدور؛ يلزم فقط حساب نشط ومربوط بـ Auth. */
export function canIssueRecovery(profile: RecoveryProfile | null): boolean {
  return Boolean(profile?.is_active && profile.auth_uid);
}

/**
 * حد طول فقط لا بديل عن secret مولد عشوائياً من 32 بايت أو أكثر. لا تقبل
 * القيمة الفارغة أو القصيرة كي لا يتحول HMAC إلى مفتاح ضعيف قابل للتخمين.
 */
export function hasUsableRecoveryRateLimitSalt(value: string): boolean {
  return new TextEncoder().encode(value).byteLength >=
    MIN_RECOVERY_RATE_LIMIT_SALT_BYTES;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** HMAC مفصول المجال؛ لا تخزن القاعدة البريد أو IP أو SHA-256 غير مملحاً. */
export async function recoveryCounterHash(
  secret: string,
  scope: "email" | "ip",
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`athar/password-recovery/v1/${scope}/${value}`),
  );
  return toHex(signature);
}
