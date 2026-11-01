import crypto from "crypto";

/**
 * Verifies the X-Shopify-Hmac-Sha256 header sent with Shopify Webhooks.
 */
export function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret?: string
): boolean {
  const webhookSecret = secret || process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!webhookSecret || !hmacHeader) {
    return false;
  }

  const generatedHash = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedHash, "base64"),
      Buffer.from(hmacHeader, "base64")
    );
  } catch {
    return false;
  }
}

/**
 * Helper to compute a valid HMAC signature for local/dashboard simulated webhook tests.
 */
export function generateShopifyWebhookHmac(rawBody: string, secret?: string): string {
  const webhookSecret = secret || process.env.SHOPIFY_WEBHOOK_SECRET || "shpss_dev_secret_for_testing_hmac";
  return crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("base64");
}
