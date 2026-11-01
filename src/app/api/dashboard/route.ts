import { NextRequest, NextResponse } from "next/server";
import { getOrCreateShop, prisma } from "@/lib/prisma";
import { dispatchBackInStockNotifications, renderBackInStockEmail } from "@/lib/email";
import { verifyShopifySessionToken } from "@/lib/shopify-session-token";

function authorizeRequest(req: NextRequest) {
  // If SHOPIFY_CLIENT_SECRET is configured, enforce strict Shopify Session Token verification
  if (process.env.SHOPIFY_CLIENT_SECRET) {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error:
              "Unauthorized: Missing Shopify session token. Please open RestockPulse from your Shopify Admin.",
          },
          { status: 401 }
        ),
      };
    }

    const verification = verifyShopifySessionToken(token);
    if (!verification.valid) {
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: `Unauthorized: ${
              verification.error || "Invalid Shopify session token"
            }. Please access via Shopify Admin.`,
          },
          { status: 401 }
        ),
      };
    }

    return { authorized: true, payload: verification.payload };
  }

  return { authorized: true };
}

export async function GET(req: NextRequest) {
  try {
    const auth = authorizeRequest(req);
    if (!auth.authorized) {
      return auth.response;
    }

    const shopDomain = req.nextUrl.searchParams.get("shop") || undefined;
    const shop = await getOrCreateShop(shopDomain);

    // Ensure any previously seeded mock items are deleted from database
    await prisma.waitlistSubscription.deleteMany({
      where: {
        shopId: shop.id,
        OR: [
          {
            productId: {
              in: [
                "gid://shopify/Product/8901234567001",
                "gid://shopify/Product/8901234567002",
                "gid://shopify/Product/8901234567003",
              ],
            },
          },
          { productTitle: { contains: "Merino" } },
          { productTitle: { contains: "Ceramic" } },
          { productTitle: { contains: "Weekender" } },
        ],
      },
    });

    const [subscriptions, notificationLogs] = await Promise.all([
      prisma.waitlistSubscription.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.notificationLog.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    // Compute KPIs & "Most Requested Out-of-Stock Variants" leaderboard
    let pendingCount = 0;
    let notifiedCount = 0;
    let convertedCount = 0;
    let pendingRevenuePotential = 0;

    const variantDemandMap = new Map<
      string,
      {
        variantId: string;
        productId: string;
        productTitle: string;
        variantTitle: string;
        imageUrl: string;
        price: string;
        sku: string | null;
        pendingSubscribers: number;
        notifiedSubscribers: number;
        potentialRevenue: number;
      }
    >();

    for (const sub of subscriptions) {
      const numericPrice = parseFloat(sub.price) || 0;
      if (sub.status === "PENDING") {
        pendingCount++;
        pendingRevenuePotential += numericPrice;
      } else if (sub.status === "NOTIFIED") {
        notifiedCount++;
      } else if (sub.status === "CONVERTED") {
        convertedCount++;
      }

      const existing = variantDemandMap.get(sub.variantId) ?? {
        variantId: sub.variantId,
        productId: sub.productId,
        productTitle: sub.productTitle,
        variantTitle: sub.variantTitle,
        imageUrl: sub.imageUrl,
        price: sub.price,
        sku: sub.sku,
        pendingSubscribers: 0,
        notifiedSubscribers: 0,
        potentialRevenue: 0,
      };

      if (sub.status === "PENDING") {
        existing.pendingSubscribers += 1;
        existing.potentialRevenue += numericPrice;
      } else if (sub.status === "NOTIFIED" || sub.status === "CONVERTED") {
        existing.notifiedSubscribers += 1;
      }

      variantDemandMap.set(sub.variantId, existing);
    }

    const topVariants = Array.from(variantDemandMap.values()).sort(
      (a, b) => b.pendingSubscribers - a.pendingSubscribers
    );

    // Generate a live HTML preview of the current email template with real PakkLett product
    const samplePreview = renderBackInStockEmail({
      shop,
      productTitle: "IceFlame NXT dunquilt - fra 324g",
      variantTitle: "NXT Summer 15°C 194x124cm 324g 800FP",
      price: "1890",
      imageUrl:
        "https://pakklett.no/cdn/shop/files/imgi_95_semi-nxt.png?v=1719875440&width=600",
      productUrl: `https://${shop.shopDomain}/products/iceflame-nxt-dunquilt-fra-324g?variant=45660467953855`,
      variantId: "45660467953855",
      recipientEmail: "kunde@pakklett.no",
    });

    const isLiveResendConfigured = Boolean(
      process.env.RESEND_API_KEY &&
        process.env.RESEND_API_KEY.startsWith("re_") &&
        process.env.RESEND_API_KEY !== "re_mock_mode"
    );

    return NextResponse.json({
      shop,
      kpis: {
        totalSubscriptions: subscriptions.length,
        pendingCount,
        notifiedCount,
        convertedCount,
        pendingRevenuePotential: pendingRevenuePotential.toFixed(2),
      },
      topVariants,
      subscriptions,
      notificationLogs,
      sampleEmailPreview: samplePreview,
      environment: {
        isLiveResendConfigured,
        hasWebhookSecret: Boolean(process.env.SHOPIFY_WEBHOOK_SECRET),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = authorizeRequest(req);
    if (!auth.authorized) {
      return auth.response;
    }

    const body = await req.json();
    const { action, shopDomain } = body;
    const shop = await getOrCreateShop(shopDomain);

    if (action === "trigger_restock") {
      const { variantId, inventoryQuantity = 10 } = body;
      if (!variantId) {
        return NextResponse.json({ error: "variantId is required" }, { status: 400 });
      }

      const pendingSubs = await prisma.waitlistSubscription.findMany({
        where: {
          shopId: shop.id,
          variantId: String(variantId),
          status: "PENDING",
        },
        orderBy: { createdAt: "asc" },
      });

      if (pendingSubs.length === 0) {
        return NextResponse.json({
          ok: true,
          notifiedCount: 0,
          message: "No pending subscribers for this variant.",
        });
      }

      const result = await dispatchBackInStockNotifications(
        shop,
        pendingSubs,
        Number(inventoryQuantity)
      );

      return NextResponse.json({
        ok: true,
        notifiedCount: result.notifiedCount,
        mode: result.mode,
        errors: result.errors,
      });
    }

    if (action === "update_settings") {
      const { settings } = body;
      const updatedShop = await prisma.shop.update({
        where: { id: shop.id },
        data: {
          shopName: settings.shopName ?? shop.shopName,
          buttonText: settings.buttonText ?? shop.buttonText,
          buttonBgColor: settings.buttonBgColor ?? shop.buttonBgColor,
          buttonTextColor: settings.buttonTextColor ?? shop.buttonTextColor,
          modalTitle: settings.modalTitle ?? shop.modalTitle,
          modalSubtitle: settings.modalSubtitle ?? shop.modalSubtitle,
          modalSubmitText: settings.modalSubmitText ?? shop.modalSubmitText,
          successMessage: settings.successMessage ?? shop.successMessage,
          showMarketingOptIn:
            typeof settings.showMarketingOptIn === "boolean"
              ? settings.showMarketingOptIn
              : shop.showMarketingOptIn,
          emailSenderName: settings.emailSenderName ?? shop.emailSenderName,
          emailReplyTo: settings.emailReplyTo ?? shop.emailReplyTo,
          emailSubject: settings.emailSubject ?? shop.emailSubject,
          emailHeading: settings.emailHeading ?? shop.emailHeading,
          emailBodyText: settings.emailBodyText ?? shop.emailBodyText,
          emailButtonText: settings.emailButtonText ?? shop.emailButtonText,
          emailAccentColor: settings.emailAccentColor ?? shop.emailAccentColor,
        },
      });

      return NextResponse.json({ ok: true, shop: updatedShop });
    }

    if (action === "delete_subscription") {
      const { subscriptionId } = body;
      await prisma.waitlistSubscription.delete({
        where: { id: String(subscriptionId) },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "reset_to_pending") {
      const { subscriptionId } = body;
      await prisma.waitlistSubscription.update({
        where: { id: String(subscriptionId) },
        data: { status: "PENDING", notifiedAt: null },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "clear_mock_data") {
      const shopDomain =
        req.headers.get("x-shop-domain") ||
        body.shopDomain ||
        process.env.DEFAULT_SHOP_DOMAIN ||
        "pakklett.no";
      const shop = await getOrCreateShop(shopDomain);
      await prisma.notificationLog.deleteMany({
        where: { shopId: shop.id },
      });
      await prisma.waitlistSubscription.deleteMany({
        where: {
          shopId: shop.id,
          productId: {
            in: [
              "gid://shopify/Product/8901234567001",
              "gid://shopify/Product/8901234567002",
              "gid://shopify/Product/8901234567003",
            ],
          },
        },
      });
      return NextResponse.json({ ok: true, message: "Mockup products cleared." });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 }
    );
  }
}
