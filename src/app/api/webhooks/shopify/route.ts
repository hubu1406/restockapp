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
}

/**
 * POST /api/webhooks/shopify
 * Receives Shopify `products/update` webhook events.
 * Verifies X-Shopify-Hmac-Sha256 signature, finds any variants where inventory_quantity > 0,
 * queries PENDING waitlist subscribers, and dispatches Back-in-Stock emails via Resend Batch API.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    const shopDomain =
      req.headers.get("x-shopify-shop-domain") ||
      process.env.DEFAULT_SHOP_DOMAIN ||
      "pakklett.no";

    // Strictly enforce cryptographic Shopify HMAC verification
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
    if (webhookSecret) {
      const isValid = verifyShopifyWebhookHmac(rawBody, hmacHeader, webhookSecret);
      if (!isValid) {
        return NextResponse.json(
          { error: "Invalid Shopify Webhook HMAC signature" },
          { status: 401 }
        );
      }
    }

    const payload = JSON.parse(rawBody) as ShopifyProductUpdatePayload;
    const variants = Array.isArray(payload.variants) ? payload.variants : [];

    // Filter variants that now have positive stock
    const restockedVariants = variants.filter(
      (v) => typeof v.inventory_quantity === "number" && v.inventory_quantity > 0
    );

    if (restockedVariants.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No variants with positive inventory_quantity in payload.",
        notifiedCount: 0,
      });
    }

    const shop = await getOrCreateShop(shopDomain);
    let totalNotified = 0;
    let deliveryMode: "RESEND_LIVE" | "SIMULATED" = "SIMULATED";
    const allErrors: string[] = [];

    for (const variant of restockedVariants) {
      const variantIdStr = String(variant.id);
      const pendingSubs = await prisma.waitlistSubscription.findMany({
        where: {
          shopId: shop.id,
          variantId: variantIdStr,
          status: "PENDING",
        },
        orderBy: { createdAt: "asc" }, // FIFO: earliest subscribers get notified first
      });

      if (pendingSubs.length > 0) {
        const result = await dispatchBackInStockNotifications(
          shop,
          pendingSubs,
          variant.inventory_quantity
        );
        totalNotified += result.notifiedCount;
        deliveryMode = result.mode;
        allErrors.push(...result.errors);
      }
    }

    return NextResponse.json({
      ok: true,
      shopDomain: shop.shopDomain,
      restockedVariantsCount: restockedVariants.length,
      notifiedCount: totalNotified,
      deliveryMode,
      errors: allErrors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing error" },
      { status: 500 }
    );
  }
}
