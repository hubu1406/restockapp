import { NextRequest, NextResponse } from "next/server";
import { getOrCreateShop, prisma } from "@/lib/prisma";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Shop-Domain",
};

const cachedCorsHeaders = {
  ...corsHeaders,
  // Cache on browser for 1 hour, on Vercel Edge CDN for 24 hours, serve stale up to 7 days
  // Prevents product page traffic & bots from waking up Neon Postgres
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  "CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
  "Vercel-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
};

// In-memory fallback cache per warm serverless instance (6 hours)
const widgetConfigCache = new Map<
  string,
  { payload: Record<string, unknown>; expiresAt: number }
>();
const MEMORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/subscribe?shop=my-shop.myshopify.com
 * Returns the public storefront widget appearance/copy settings for the given shop.
 * Aggressively cached at Vercel Edge CDN so storefront traffic does not wake up Neon Postgres.
 */
export async function GET(req: NextRequest) {
  try {
    const shopDomain =
      req.nextUrl.searchParams.get("shop") ||
      req.headers.get("x-shop-domain") ||
      undefined;

    const cacheKey = (shopDomain || "default").trim().toLowerCase();
    const cached = widgetConfigCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, { headers: cachedCorsHeaders });
    }

    const shop = await getOrCreateShop(shopDomain);
    const payload = {
      shopDomain: shop.shopDomain,
      widget: {
        buttonText: shop.buttonText,
        buttonBgColor: shop.buttonBgColor,
        buttonTextColor: shop.buttonTextColor,
        modalTitle: shop.modalTitle,
        modalSubtitle: shop.modalSubtitle,
        modalSubmitText: shop.modalSubmitText,
        successMessage: shop.successMessage,
        showMarketingOptIn: shop.showMarketingOptIn,
      },
    };

    widgetConfigCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
    });

    return NextResponse.json(payload, { headers: cachedCorsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load widget config" },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * POST /api/subscribe
 * Public Storefront endpoint called by the Shopify Theme Widget when a customer submits their email.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      shopDomain,
      email,
      productId,
      variantId,
      productTitle,
      variantTitle,
      productHandle,
      productUrl,
      imageUrl,
      price,
      sku,
      acceptsMarketing,
    } = body;

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json(
        { error: "Vennligst oppgi en gyldig e-postadresse." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!variantId || !productTitle) {
      return NextResponse.json(
        { error: "Missing variantId or productTitle." },
        { status: 400, headers: corsHeaders }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const shop = await getOrCreateShop(shopDomain);

    // Check if there is already an active PENDING subscription for this (shopId, variantId, email)
    const existingPending = await prisma.waitlistSubscription.findFirst({
      where: {
        shopId: shop.id,
        variantId: String(variantId),
        email: normalizedEmail,
        status: "PENDING",
      },
    });

    if (existingPending) {
      return NextResponse.json(
        {
          ok: true,
          duplicate: true,
          message: shop.successMessage,
          subscriptionId: existingPending.id,
        },
        { headers: corsHeaders }
      );
    }

    const subscription = await prisma.waitlistSubscription.create({
      data: {
        shopId: shop.id,
        productId: String(productId || variantId),
        variantId: String(variantId),
        productTitle: String(productTitle),
        variantTitle: String(variantTitle || "Default Title"),
        productHandle: String(productHandle || ""),
        productUrl:
          String(productUrl || "") ||
          `https://${shop.shopDomain}/products/${productHandle || ""}?variant=${variantId}`,
        imageUrl: String(imageUrl || ""),
        price: String(price || "0.00"),
        sku: sku ? String(sku) : null,
        email: normalizedEmail,
        acceptsMarketing: Boolean(acceptsMarketing),
        status: "PENDING",
      },
    });

    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        message: shop.successMessage,
        subscriptionId: subscription.id,
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to subscribe" },
      { status: 500, headers: corsHeaders }
    );
  }
}
