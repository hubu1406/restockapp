import { NextRequest, NextResponse } from "next/server";
import { getOrCreateShop, prisma } from "@/lib/prisma";
import { dispatchBackInStockNotifications, renderBackInStockEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  try {
    const shopDomain = req.nextUrl.searchParams.get("shop") || undefined;
    const shop = await getOrCreateShop(shopDomain);

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

    // Generate a live HTML preview of the current email template
    const samplePreview = renderBackInStockEmail({
      shop,
      productTitle: "Merino Wool Oversized Crewneck",
      variantTitle: "Charcoal / Medium",
      price: "128.00",
      imageUrl:
        "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=600&q=80",
      productUrl: `https://${shop.shopDomain}/products/merino-wool-oversized-crewneck?variant=44001122334001`,
      variantId: "44001122334001",
      recipientEmail: "customer@example.com",
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: 500 }
    );
  }
}
