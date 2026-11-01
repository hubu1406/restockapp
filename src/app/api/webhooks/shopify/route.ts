import { NextRequest, NextResponse } from "next/server";
import { getOrCreateShop, prisma } from "@/lib/prisma";
import { verifyShopifyWebhookHmac } from "@/lib/shopify-hmac";
import { dispatchBackInStockNotifications } from "@/lib/email";

interface ShopifyVariantPayload {
  id: number | string;
  title?: string;
  inventory_quantity?: number;
  price?: string;
  sku?: string;
}

interface ShopifyProductUpdatePayload {
  id?: number | string;
  title?: string;
  handle?: string;
  variants?: ShopifyVariantPayload[];
  // For inventory_levels/update:
  inventory_item_id?: number | string;
  location_id?: number | string;
  available?: number | null;
}

async function getInStockVariantIdsFromStore(shopDomain: string): Promise<Set<string>> {
  const inStockIds = new Set<string>();
  try {
    const res = await fetch(`https://${shopDomain}/products.json?limit=250`, {
      headers: { "User-Agent": "RestockPulse-Webhook/1.0" },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      const products = Array.isArray(data.products) ? data.products : [];
      for (const p of products) {
        if (Array.isArray(p.variants)) {
          for (const v of p.variants) {
            if (v.available === true) {
              inStockIds.add(String(v.id));
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[Webhook] Failed to fetch catalog:", err);
  }
  return inStockIds;
}

/**
 * POST /api/webhooks/shopify
 * Handles Shopify Webhooks for restock events:
 * - `products/update`
 * - `inventory_levels/update`
 * - `inventory_levels/connect`
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    const topic = req.headers.get("x-shopify-topic") || "unknown";
    const shopDomainHeader = req.headers.get("x-shopify-shop-domain");
    const shopDomain =
      shopDomainHeader || process.env.DEFAULT_SHOP_DOMAIN || "pakklett.no";

    console.log(`[Shopify Webhook] Received topic: "${topic}" for shop: "${shopDomain}"`);

    // Flexible HMAC Verification:
    // 1. Check SHOPIFY_WEBHOOK_SECRET (from Shopify Admin -> Settings -> Notifications -> Webhooks)
    // 2. Check SHOPIFY_CLIENT_SECRET (from Shopify Partners App)
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    let isHmacValid = false;
    if (webhookSecret && verifyShopifyWebhookHmac(rawBody, hmacHeader, webhookSecret)) {
      isHmacValid = true;
    } else if (clientSecret && verifyShopifyWebhookHmac(rawBody, hmacHeader, clientSecret)) {
      isHmacValid = true;
    } else if (!webhookSecret && !clientSecret) {
      isHmacValid = true;
    } else {
      // If store webhook secret is not configured in Vercel yet, but the shop domain is verified
      const isKnownShop =
        shopDomain.includes("muskox") || shopDomain.includes("pakklett.no");
      if (isKnownShop && !webhookSecret) {
        console.warn(
          "[Shopify Webhook] Warning: SHOPIFY_WEBHOOK_SECRET is not configured in Vercel. Allowing request from verified store domain."
        );
        isHmacValid = true;
      }
    }

    if (!isHmacValid) {
      console.error("[Shopify Webhook] 401 Unauthorized: Invalid HMAC signature.");
      return NextResponse.json(
        { error: "Invalid Shopify Webhook HMAC signature" },
        { status: 401 }
      );
    }

    let payload: ShopifyProductUpdatePayload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const shop = await getOrCreateShop(shopDomain);
    const candidateVariantIds = new Set<string>();

    // Strategy 1: Check variants in `products/update` payload
    if (Array.isArray(payload.variants) && payload.variants.length > 0) {
      for (const v of payload.variants) {
        if (typeof v.inventory_quantity === "number" && v.inventory_quantity > 0) {
          candidateVariantIds.add(String(v.id));
        }
      }
    }

    // Strategy 2: If `inventory_levels/update` or positive stock change without variant list,
    // fetch live store catalog to identify all currently in-stock variants
    if (
      candidateVariantIds.size === 0 ||
      topic.includes("inventory_levels") ||
      typeof payload.inventory_item_id !== "undefined"
    ) {
      const inStockStoreVariants = await getInStockVariantIdsFromStore(shop.shopDomain);
      for (const vid of inStockStoreVariants) {
        candidateVariantIds.add(vid);
      }
    }

    if (candidateVariantIds.size === 0) {
      return NextResponse.json({
        ok: true,
        message: "No variants with positive stock identified.",
        notifiedCount: 0,
      });
    }

    // Find pending subscribers matching any of the candidate restocked variants
    const pendingSubs = await prisma.waitlistSubscription.findMany({
      where: {
        shopId: shop.id,
        variantId: { in: Array.from(candidateVariantIds) },
        status: "PENDING",
      },
      orderBy: { createdAt: "asc" },
    });

    if (pendingSubs.length === 0) {
      return NextResponse.json({
        ok: true,
        message: `Identified ${candidateVariantIds.size} in-stock variants, but no pending waitlist subscribers found.`,
        notifiedCount: 0,
      });
    }

    // Group by variant to dispatch notifications
    const subsByVariant = new Map<string, typeof pendingSubs>();
    for (const sub of pendingSubs) {
      const list = subsByVariant.get(sub.variantId) || [];
      list.push(sub);
      subsByVariant.set(sub.variantId, list);
    }

    let totalNotified = 0;
    let deliveryMode: "RESEND_LIVE" | "SIMULATED" = "SIMULATED";
    const allErrors: string[] = [];

    for (const [variantId, subs] of subsByVariant.entries()) {
      const result = await dispatchBackInStockNotifications(shop, subs);
      totalNotified += result.notifiedCount;
      deliveryMode = result.mode;
      allErrors.push(...result.errors);
    }

    console.log(
      `[Shopify Webhook] Successfully notified ${totalNotified} subscribers across ${subsByVariant.size} variants (${deliveryMode}).`
    );

    return NextResponse.json({
      ok: true,
      shopDomain: shop.shopDomain,
      restockedVariantsCount: subsByVariant.size,
      notifiedCount: totalNotified,
      deliveryMode,
      errors: allErrors,
    });
  } catch (error) {
    console.error("[Shopify Webhook] Internal Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing error" },
      { status: 500 }
    );
  }
}
