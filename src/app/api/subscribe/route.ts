import { NextRequest, NextResponse } from "next/server";
import { getOrCreateShop, prisma } from "@/lib/prisma";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Shop-Domain",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/subscribe?shop=my-shop.myshopify.com
 * Returns the public storefront widget appearance/copy settings for the given shop.
 */
export async function GET(req: NextRequest) {
  try {
    const shopDomain =
      req.nextUrl.searchParams.get("shop") ||
      req.headers.get("x-shop-domain") ||
      undefined;

    const shop = await getOrCreateShop(shopDomain);

    return NextResponse.json(
      {
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
      },
      { headers: corsHeaders }
    );
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
