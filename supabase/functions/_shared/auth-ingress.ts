import { normalizedClientIp, verifiedManagedClientIp } from "./client-ip.ts";

/** Versioned wire format shared only by the Worker and the Edge Functions. */
export const AUTH_INGRESS_VERSION = "v1";
export const AUTH_INGRESS_HEADER_PREFIX = "x-athar-ingress-";
export const AUTH_INGRESS_MAX_HEADER_BYTES = 512;
export const AUTH_INGRESS_MAX_AGE_SECONDS = 60;
export const AUTH_INGRESS_MAX_FUTURE_SECONDS = 10;
export const AUTH_INGRESS_REPLAY_TTL_SECONDS = 120;
export const MIN_AUTH_INGRESS_SECRET_BYTES = 32;
export const MIN_AUTH_INGRESS_NONCE_BYTES = 16;
export const MAX_AUTH_INGRESS_NONCE_BYTES = 64;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Web Crypto type definitions distinguish a view backed by a SharedArrayBuffer.
 * Auth inputs are copied into an owned ArrayBuffer before crypto consumes them.
 * This avoids widening the accepted runtime input or relying on a type assertion.
 */
function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export type BoundedJsonBody = {
  bytes: Uint8Array;
  value: Record<string, unknown>;
};

export type VerifiedAuthIngress = {
  clientIp: string;
  mode: "legacy-proxy" | "signed";
  /** Present only for a verified signed request; never log or return this value. */
  replayNonceHash?: string;
  /** Unix seconds, bounded from the signed timestamp and used by the replay RPC. */
  replayExpiresAt?: number;
};

export type AuthIngressVerificationOptions = {
  expectedMethod: "POST";
  expectedPath: string;
  getEnv: (name: string) => string | undefined;
  nowSeconds?: number;
};

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

/**
 * The HMAC secret is deliberately base64url (without padding), not arbitrary
 * text. This makes its entropy auditable and rejects short or malformed setup.
 */
export function decodeAuthIngressSecret(
  value: string | undefined,
): Uint8Array | null {
  if (!value || value.length > 256) return null;
  const bytes = base64UrlToBytes(value);
  return bytes && bytes.byteLength >= MIN_AUTH_INGRESS_SECRET_BYTES
    ? bytes
    : null;
}

export function authIngressCanonicalMessage(fields: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  clientIp: string;
  bodySha256: string;
}): string {
  // Every field is independently syntax-checked before signing or verifying,
  // so newline-delimited canonicalization is unambiguous.
  return [
    "athar-auth-ingress",
    AUTH_INGRESS_VERSION,
    fields.method,
    fields.path,
    fields.timestamp,
    fields.nonce,
    fields.clientIp,
    fields.bodySha256,
    "",
  ].join("\n");
}

async function ingressDiagnostic(
  stage: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  // Hashes/lengths only; never log secret, signature, nonce, IP, body, or the
  // canonical message itself.
  console.error(JSON.stringify({
    event: "auth_ingress_diagnostic",
    stage,
    ...details,
  }));
}

async function textFingerprint(value: string): Promise<string> {
  return (await sha256Hex(encoder.encode(value))).slice(0, 8);
}

async function hmacKey(
  secret: Uint8Array,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function authIngressSignature(
  secret: Uint8Array,
  message: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, ["sign"]),
    encoder.encode(message),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyAuthIngressSignature(
  secret: Uint8Array,
  message: string,
  suppliedSignature: string,
): Promise<boolean> {
  const signature = base64UrlToBytes(suppliedSignature);
  if (!signature || signature.byteLength !== 32) return false;
  return await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, ["verify"]),
    ownedArrayBuffer(signature),
    encoder.encode(message),
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function authIngressNonceHash(nonce: string): Promise<string> {
  return await sha256Hex(
    encoder.encode(`athar-auth-ingress/nonce/v1/${nonce}`),
  );
}

export function randomAuthIngressNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function declaredBodyLength(req: Request, maxBytes: number): boolean {
  const contentLength = req.headers.get("content-length");
  return !contentLength ||
    (/^\d{1,8}$/.test(contentLength) && Number(contentLength) <= maxBytes);
}

/** Reads once, enforces an actual byte cap, rejects invalid UTF-8 and arrays. */
export async function readBoundedJsonObject(
  req: Request,
  maxBytes: number,
): Promise<BoundedJsonBody | null> {
  if (
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
    !declaredBodyLength(req, maxBytes)
  ) {
    return null;
  }
  const reader = req.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(decoder.decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return { bytes, value: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}

function oneSignedHeader(
  req: Request,
  name: string,
  maxLength: number,
): string | null {
  const value = req.headers.get(name);
  // Fetch folds duplicate headers with a comma. No signed field admits commas,
  // so reject them rather than selecting a value from an ambiguous request.
  if (
    !value || value.length > maxLength || value.includes(",") ||
    /[\r\n\x00]/.test(value)
  ) {
    return null;
  }
  return value;
}

function onlyExpectedSignedHeaders(req: Request): boolean {
  const expected = new Set([
    `${AUTH_INGRESS_HEADER_PREFIX}version`,
    `${AUTH_INGRESS_HEADER_PREFIX}timestamp`,
    `${AUTH_INGRESS_HEADER_PREFIX}nonce`,
    `${AUTH_INGRESS_HEADER_PREFIX}ip`,
    `${AUTH_INGRESS_HEADER_PREFIX}body-sha256`,
    `${AUTH_INGRESS_HEADER_PREFIX}method`,
    `${AUTH_INGRESS_HEADER_PREFIX}path`,
    `${AUTH_INGRESS_HEADER_PREFIX}signature`,
  ]);
  for (const [name, value] of req.headers) {
    if (name.toLowerCase().startsWith(AUTH_INGRESS_HEADER_PREFIX)) {
      if (
        !expected.has(name.toLowerCase()) ||
        value.length > AUTH_INGRESS_MAX_HEADER_BYTES
      ) {
        return false;
      }
    }
  }
  return true;
}

function validNonce(value: string): boolean {
  const bytes = base64UrlToBytes(value);
  return Boolean(
    bytes && bytes.byteLength >= MIN_AUTH_INGRESS_NONCE_BYTES &&
      bytes.byteLength <= MAX_AUTH_INGRESS_NONCE_BYTES,
  );
}

function exactPath(req: Request, expectedPath: string): boolean {
  try {
    return new URL(req.url).pathname === expectedPath;
  } catch {
    return false;
  }
}

async function verifySignedAuthIngress(
  req: Request,
  body: Uint8Array,
  options: AuthIngressVerificationOptions,
): Promise<VerifiedAuthIngress | null> {
  const reject = async (
    stage: string,
    details: Record<string, unknown> = {},
  ): Promise<null> => {
    await ingressDiagnostic(stage, details);
    return null;
  };
  const secret = decodeAuthIngressSecret(
    options.getEnv("AUTH_INGRESS_HMAC_SECRET"),
  );
  if (
    !secret || req.method !== options.expectedMethod ||
    !exactPath(req, options.expectedPath)
  ) {
    return await reject("config_or_request_shape_rejected", {
      secret_valid_format: Boolean(secret),
      method_match: req.method === options.expectedMethod,
      request_path_match: exactPath(req, options.expectedPath),
    });
  }
  if (!onlyExpectedSignedHeaders(req)) {
    return await reject("unexpected_signed_header_rejected");
  }

  const version = oneSignedHeader(
    req,
    `${AUTH_INGRESS_HEADER_PREFIX}version`,
    8,
  );
  const timestamp = oneSignedHeader(
    req,
    `${AUTH_INGRESS_HEADER_PREFIX}timestamp`,
    16,
  );
  const nonce = oneSignedHeader(req, `${AUTH_INGRESS_HEADER_PREFIX}nonce`, 128);
  const claimedIp = oneSignedHeader(req, `${AUTH_INGRESS_HEADER_PREFIX}ip`, 64);
  const bodySha256 = oneSignedHeader(
    req,
    `${AUTH_INGRESS_HEADER_PREFIX}body-sha256`,
    64,
  );
  const method = oneSignedHeader(req, `${AUTH_INGRESS_HEADER_PREFIX}method`, 8);
  const path = oneSignedHeader(req, `${AUTH_INGRESS_HEADER_PREFIX}path`, 256);
  const signature = oneSignedHeader(
    req,
    `${AUTH_INGRESS_HEADER_PREFIX}signature`,
    64,
  );
  if (
    version !== AUTH_INGRESS_VERSION || !timestamp || !nonce || !claimedIp ||
    !bodySha256 ||
    !method || !path || !signature || method !== options.expectedMethod ||
    path !== options.expectedPath || !/^\d{1,10}$/.test(timestamp) ||
    !validNonce(nonce) ||
    !/^[a-f0-9]{64}$/.test(bodySha256) || !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return await reject("signed_header_shape_rejected", {
      version_match: version === AUTH_INGRESS_VERSION,
      method_match: method === options.expectedMethod,
      path_match: path === options.expectedPath,
      timestamp_format: Boolean(timestamp && /^\d{1,10}$/.test(timestamp)),
      nonce_format: Boolean(nonce && validNonce(nonce)),
      body_hash_format: Boolean(bodySha256 && /^[a-f0-9]{64}$/.test(bodySha256)),
      signature_format: Boolean(signature && /^[A-Za-z0-9_-]{43}$/.test(signature)),
    });
  }

  const clientIp = normalizedClientIp(claimedIp);
  if (!clientIp) {
    return await reject("client_ip_rejected", {
      claimed_ip_fingerprint: await textFingerprint(claimedIp),
    });
  }
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const signedSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(signedSeconds) ||
    signedSeconds < nowSeconds - AUTH_INGRESS_MAX_AGE_SECONDS ||
    signedSeconds > nowSeconds + AUTH_INGRESS_MAX_FUTURE_SECONDS
  ) {
    return await reject("timestamp_rejected", {
      age_seconds: nowSeconds - signedSeconds,
    });
  }

  const actualBodyHash = await sha256Hex(body);
  if (actualBodyHash !== bodySha256) {
    return await reject("body_hash_mismatch", {
      supplied_body_hash_prefix: bodySha256.slice(0, 8),
      actual_body_hash_prefix: actualBodyHash.slice(0, 8),
    });
  }
  const canonicalMessage = authIngressCanonicalMessage({
    method,
    path,
    timestamp,
    nonce,
    clientIp,
    bodySha256,
  });
  const canonicalHash = (await sha256Hex(encoder.encode(canonicalMessage)))
    .slice(0, 8);
  await ingressDiagnostic("canonical_message_built", {
    canonical_hash_prefix: canonicalHash,
    method,
    path,
    timestamp_length: timestamp.length,
    nonce_length: nonce.length,
    client_ip_fingerprint: await textFingerprint(clientIp),
    body_hash_prefix: bodySha256.slice(0, 8),
  });
  const validSignature = await verifyAuthIngressSignature(
    secret,
    canonicalMessage,
    signature,
  );
  if (!validSignature) {
    return await reject("signature_mismatch", {
      canonical_hash_prefix: canonicalHash,
      signature_length: signature.length,
    });
  }

  return {
    clientIp,
    mode: "signed",
    replayNonceHash: await authIngressNonceHash(nonce),
    replayExpiresAt: signedSeconds + AUTH_INGRESS_REPLAY_TTL_SECONDS,
  };
}

/**
 * Signed ingress is an explicit opt-in. A bad/missing signed configuration
 * never falls back to the legacy CF/XFF scheme. Legacy itself is also opt-in
 * and remains disabled unless both settings are intentionally set.
 */
export async function verifiedAuthIngress(
  req: Request,
  body: Uint8Array,
  options: AuthIngressVerificationOptions,
): Promise<VerifiedAuthIngress | null> {
  const mode = options.getEnv("AUTH_INGRESS_MODE") ?? "disabled";
  if (mode === "signed") {
    return await verifySignedAuthIngress(req, body, options);
  }
  if (
    mode !== "legacy-proxy" ||
    options.getEnv("AUTH_PROXY_IP_VERIFIED") !== "true"
  ) {
    return null;
  }
  const clientIp = verifiedManagedClientIp(req, true);
  return clientIp ? { clientIp, mode: "legacy-proxy" } : null;
}
