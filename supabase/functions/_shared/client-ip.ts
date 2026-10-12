/**
 * Opt-in deployment contract, not a claim that headers authenticate themselves.
 * Enable AUTH_PROXY_IP_VERIFIED=true only after documenting that the managed
 * ingress overwrites CF-Connecting-IP and appends the real peer as the last XFF
 * hop, with no direct-origin bypass. Otherwise both auth endpoints fail closed.
 */
export function normalizedClientIp(value: string | null): string | null {
  const raw = (value || "").trim();
  if (!raw || raw.length > 45 || /[\s%\[\]\/]/.test(raw)) return null;
  if (raw.includes(":")) {
    try {
      const host = new URL(`http://[${raw}]/`).hostname;
      return host.slice(1, -1).toLowerCase();
    } catch {
      return null;
    }
  }
  const parts = raw.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
  ) return null;
  return parts.map(Number).join(".");
}

export function verifiedManagedClientIp(
  req: Request,
  ingressVerified = false,
): string | null {
  if (!ingressVerified) return null;
  const cfIp = normalizedClientIp(req.headers.get("cf-connecting-ip"));
  const xff = req.headers.get("x-forwarded-for");
  if (!cfIp || !xff || xff.length > 512) return null;
  const hops = xff.split(",").map(normalizedClientIp);
  if (hops.length > 8 || hops.some((hop) => !hop)) return null;
  return hops.at(-1) === cfIp ? cfIp : null;
}
