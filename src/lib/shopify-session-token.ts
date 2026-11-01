import crypto from "crypto";

export interface ShopifySessionPayload {
  iss: string; // e.g. "https://muskox.myshopify.com/admin"
  dest: string; // e.g. "https://muskox.myshopify.com"
  aud: string; // Client ID
  sub: string; // User ID
  exp: number; // Expiration timestamp in seconds
  nbf: number; // Not before timestamp in seconds
  iat: number; // Issued at timestamp in seconds
  jti: string;
  sid: string;
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  return Buffer.from(str, "base64").toString("utf8");
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Cryptographically verifies a Shopify Session Token (JWT).
 * Signature is computed with HMAC-SHA256 using the app's Client Secret.
 */
export function verifyShopifySessionToken(
  token: string,
  clientSecret?: string,
  clientId?: string
): { valid: boolean; payload?: ShopifySessionPayload; error?: string } {
  const secret = clientSecret || process.env.SHOPIFY_CLIENT_SECRET;
  const expectedAud = clientId || process.env.SHOPIFY_CLIENT_ID;

  if (!secret) {
    return { valid: false, error: "Missing SHOPIFY_CLIENT_SECRET on server" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid token format: expected 3 JWT parts" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Verify cryptographic signature
  const calculatedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();

  const expectedSignatureB64 = base64UrlEncode(calculatedSignature);

  try {
    const a = Buffer.from(signatureB64);
    const b = Buffer.from(expectedSignatureB64);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, error: "Invalid signature" };
    }
  } catch {
    return { valid: false, error: "Signature verification failed" };
  }

  // 2. Parse payload JSON
  let payload: ShopifySessionPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { valid: false, error: "Invalid payload JSON" };
  }

  const now = Math.floor(Date.now() / 1000);

  // 3. Verify expiration and active timestamps (with 15s clock drift tolerance)
  if (payload.exp && payload.exp < now - 15) {
    return { valid: false, error: "Token expired" };
  }
  if (payload.nbf && payload.nbf > now + 15) {
    return { valid: false, error: "Token not yet active" };
  }

  // 4. Verify audience (matches Client ID)
  if (expectedAud && payload.aud !== expectedAud) {
    return {
      valid: false,
      error: `Invalid audience: expected ${expectedAud}, got ${payload.aud}`,
    };
  }

  // 5. Verify shop domain
  const allowedShop = (
    process.env.SHOPIFY_STORE_DOMAIN || "muskox.myshopify.com"
  ).toLowerCase();
  const destUrl = (payload.dest || "").toLowerCase();
  const issUrl = (payload.iss || "").toLowerCase();

  const isStoreAuthorized =
    destUrl.includes(allowedShop) ||
    issUrl.includes(allowedShop) ||
    destUrl.includes("pakklett.no") ||
    issUrl.includes("pakklett.no");

  if (!isStoreAuthorized) {
    return {
      valid: false,
      error: `Unauthorized shop domain: ${destUrl || issUrl}`,
    };
  }

  return { valid: true, payload };
}
