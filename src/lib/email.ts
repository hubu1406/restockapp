import { Resend } from "resend";
import { Shop, WaitlistSubscription } from "@prisma/client";
import { prisma } from "./prisma";

export interface EmailTemplateData {
  shop: Pick<
    Shop,
    | "shopName"
    | "shopDomain"
    | "buttonBgColor"
    | "emailSenderName"
    | "emailSubject"
    | "emailHeading"
    | "emailBodyText"
    | "emailButtonText"
    | "emailAccentColor"
  >;
  productTitle: string;
  variantTitle: string;
  price: string;
  imageUrl: string;
  productUrl: string;
  variantId: string;
  recipientEmail: string;
}

export interface DailyEmailUsage {
  sentInLast24h: number;
  limit: number;
  remaining: number;
  isQuotaExceeded: boolean;
  resetsInHours: number;
}

/**
 * Calculates email sending volume over a rolling 24-hour window.
 * Free Resend tier limit: 100 emails/day.
 * We default to a safe cap of 95 to prevent hitting the hard API wall.
 */
export async function getDailyEmailUsage(
  shopId: string,
  customLimit?: number
): Promise<DailyEmailUsage> {
  const limit =
    customLimit ??
    (process.env.DAILY_EMAIL_LIMIT
      ? parseInt(process.env.DAILY_EMAIL_LIMIT, 10)
      : 95);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const sentLogs = await prisma.notificationLog.findMany({
    where: {
      shopId,
      deliveryStatus: "SENT",
      createdAt: { gte: oneDayAgo },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const sentInLast24h = sentLogs.length;
  const remaining = Math.max(0, limit - sentInLast24h);
  const isQuotaExceeded = remaining <= 0;

  let resetsInHours = 0;
  if (sentLogs.length > 0) {
    const oldest = sentLogs[0].createdAt.getTime();
    const expiresAt = oldest + 24 * 60 * 60 * 1000;
    resetsInHours = Math.max(
      0,
      Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60))
    );
  }

  return {
    sentInLast24h,
    limit,
    remaining,
    isQuotaExceeded,
    resetsInHours,
  };
}

/**
 * Replaces template variables like {{product_title}} or {{shop_name}}
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Renders a responsive, mobile-friendly HTML email for Back in Stock alerts.
 * Direct-to-product layout:
 * 1. Single top line: "Tilbake på lager"
 * 2. Clickable product image
 * 3. Product title, variant & price + Primary "Kjøp nå" CTA button / link
 * 4. Other text / notes placed after
 */
export function renderBackInStockEmail(data: EmailTemplateData): {
  subject: string;
  html: string;
} {
  const vars = {
    product_title: data.productTitle,
    variant_title: data.variantTitle,
    shop_name: data.shop.shopName,
    price: `${data.price} kr`,
  };

  const subject = interpolateTemplate(data.shop.emailSubject, vars);
  const bodyText = interpolateTemplate(data.shop.emailBodyText, vars);
  const buttonText = interpolateTemplate(data.shop.emailButtonText, vars);
  const buttonColor = data.shop.buttonBgColor || data.shop.emailAccentColor || "#2D2A38";

  // Direct Shopify cart permalink or product page link with UTM tracking
  const checkoutUrl =
    data.productUrl ||
    `https://${data.shop.shopDomain}/cart/${data.variantId}:1?utm_source=restockpulse&utm_medium=email`;

  const imageBlock = data.imageUrl
    ? `<tr>
        <td style="padding: 4px 28px 16px; text-align: center;">
          <a href="${checkoutUrl}" style="display: inline-block; text-decoration: none;">
            <img src="${data.imageUrl}" alt="${data.productTitle}" style="max-width: 280px; width: 100%; height: auto; border-radius: 12px; border: 1px solid #e5e7eb; object-fit: cover; display: block; margin: 0 auto;" />
          </a>
        </td>
       </tr>`
    : "";

  const variantSubtitle =
    data.variantTitle && data.variantTitle !== "Default Title"
      ? `<div style="font-size: 14px; color: #6b7280; margin-bottom: 4px;">Variant: <strong>${data.variantTitle}</strong></div>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
  <style>
    /* Prevent email clients from making links blue and underlined */
    a, a:visited, a:hover, a:active {
      text-decoration: none;
    }
    .brand-header-link, .brand-header-link:visited, .brand-header-link:hover, .brand-header-link:active {
      color: #ffffff !important;
      text-decoration: none !important;
    }
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
  </style>
</head>
<body id="body" style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f3f4f6; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 500px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
          
          <!-- Thin Brand Header Bar -->
          <tr>
            <td style="padding: 12px 24px; background-color: ${buttonColor}; text-align: center;">
              <a href="https://pakklett.no" target="_blank" rel="noopener noreferrer" class="brand-header-link" style="color: #ffffff !important; text-decoration: none !important; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; display: inline-block;">
                <span style="color: #ffffff !important; text-decoration: none !important;">pakklett.no</span>
              </a>
            </td>
          </tr>

          <!-- Single Top Line: Tilbake på lager -->
          <tr>
            <td style="padding: 24px 28px 14px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #111827; letter-spacing: -0.3px;">
                Tilbake på lager
              </h1>
            </td>
          </tr>

          <!-- Product Image right at the top -->
          ${imageBlock}

          <!-- Primary CTA Button directly under the photo -->
          <tr>
            <td style="padding: 4px 28px 18px; text-align: center;">
              <a href="${checkoutUrl}" style="display: inline-block; background-color: ${buttonColor}; color: #ffffff !important; font-size: 15px; font-weight: 700; text-decoration: none !important; padding: 14px 44px; border-radius: 8px; letter-spacing: 0.2px; box-shadow: 0 2px 6px rgba(0,0,0,0.12);">
                ${buttonText} &rarr;
              </a>
            </td>
          </tr>

          <!-- Product Title, Variant, Price & Notes -->
          <tr>
            <td style="padding: 0 28px 24px; text-align: center;">
              <h2 style="margin: 0 0 4px; font-size: 18px; font-weight: 700; color: #111827; line-height: 1.3;">
                ${data.productTitle}
              </h2>
              ${variantSubtitle}
              <div style="font-size: 17px; font-weight: 800; color: #111827; margin: 6px 0 16px;">
                ${data.price} kr
              </div>

              <!-- Other explanatory text placed after -->
              ${
                bodyText
                  ? `<div style="border-top: 1px solid #f3f4f6; padding-top: 16px;">
                      <p style="margin: 0 auto; font-size: 14px; line-height: 1.6; color: #4b5563; max-width: 420px;">
                        ${bodyText}
                      </p>
                    </div>`
                  : ""
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 18px 28px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af; line-height: 1.5;">
              Du mottar denne e-posten fordi du ba om et engangsvarsel når denne varen kom tilbake på lager hos ${data.shop.emailSenderName || data.shop.shopDomain}.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/**
 * Dispatches Back-in-Stock emails for a batch of PENDING subscriptions.
 * Enforces a daily sending quota (defaults to 95/day) to prevent hitting
 * Resend Free tier daily rate limits (100 emails/day).
 * Remaining subscribers stay in status PENDING and will be picked up
 * automatically the next day by the daily cron queue runner.
 */
export async function dispatchBackInStockNotifications(
  shop: Shop,
  subscriptions: WaitlistSubscription[],
  inventoryAvailable?: number,
  options?: { bypassDailyQuota?: boolean }
): Promise<{
  notifiedCount: number;
  queuedCount: number;
  quotaExceeded: boolean;
  mode: "RESEND_LIVE" | "SIMULATED";
  errors: string[];
  message?: string;
}> {
  if (subscriptions.length === 0) {
    return {
      notifiedCount: 0,
      queuedCount: 0,
      quotaExceeded: false,
      mode: "SIMULATED",
      errors: [],
    };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const isLiveResend = Boolean(
    apiKey && apiKey.startsWith("re_") && apiKey !== "re_mock_mode"
  );
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ||
    `${shop.emailSenderName || "PakkLett"} <noreply@pakklett.no>`;

  // Check 24-hour daily quota limit (safety cap at 95/day)
  const usage = await getDailyEmailUsage(shop.id);
  if (isLiveResend && !options?.bypassDailyQuota && usage.isQuotaExceeded) {
    return {
      notifiedCount: 0,
      queuedCount: subscriptions.length,
      quotaExceeded: true,
      mode: "RESEND_LIVE",
      errors: [
        `Dagsgrensen på ${usage.limit} e-poster er nådd for siste 24 timer. Resterende ${subscriptions.length} varsler venter i kø til i morgen.`,
      ],
      message: `Dagsgrensen på ${usage.limit} e-poster er nådd. Resterende abonnenter er satt på vent til i morgen.`,
    };
  }

  // Calculate allowed emails for this batch
  const inventoryCap =
    inventoryAvailable && inventoryAvailable > 0
      ? Math.max(inventoryAvailable * 5, 25)
      : subscriptions.length;

  const quotaCap =
    isLiveResend && !options?.bypassDailyQuota
      ? Math.min(subscriptions.length, usage.remaining)
      : subscriptions.length;

  const allowedBatchSize = Math.max(
    0,
    Math.min(subscriptions.length, inventoryCap, quotaCap)
  );

  if (allowedBatchSize === 0) {
    return {
      notifiedCount: 0,
      queuedCount: subscriptions.length,
      quotaExceeded: usage.isQuotaExceeded,
      mode: isLiveResend ? "RESEND_LIVE" : "SIMULATED",
      errors: [
        `Ingen e-poster kunne sendes nå. Resterende kvote i dag: ${usage.remaining}.`,
      ],
    };
  }

  const targetSubs = subscriptions.slice(0, allowedBatchSize);
  const queuedSubsCount = subscriptions.length - targetSubs.length;

  const renderedEmails = targetSubs.map((sub) => {
    const rendered = renderBackInStockEmail({
      shop,
      productTitle: sub.productTitle,
      variantTitle: sub.variantTitle,
      price: sub.price,
      imageUrl: sub.imageUrl,
      productUrl: sub.productUrl,
      variantId: sub.variantId,
      recipientEmail: sub.email,
    });
    return { sub, ...rendered };
  });

  const errors: string[] = [];
  let notifiedCount = 0;
  let hitQuotaDuringSend = false;
  const perSubStatus = new Map<
    string,
    { status: "SENT" | "SIMULATED" | "FAILED"; error?: string }
  >();

  if (isLiveResend) {
    const resend = new Resend(apiKey);
    for (const item of renderedEmails) {
      if (hitQuotaDuringSend) {
        break;
      }

      // Skip sending to fake @example.com demo addresses so Resend sandbox doesn't reject the batch
      if (item.sub.email.endsWith("@example.com")) {
        perSubStatus.set(item.sub.id, { status: "SIMULATED" });
        notifiedCount++;
        continue;
      }

      try {
        const response = await resend.emails.send({
          from: fromAddress,
          to: [item.sub.email],
          replyTo: shop.emailReplyTo || undefined,
          subject: item.subject,
          html: item.html,
        });

        if (response.error) {
          const errMsg = response.error.message || "Unknown error";
          errors.push(`${item.sub.email}: ${errMsg}`);
          if (
            errMsg.toLowerCase().includes("quota") ||
            errMsg.toLowerCase().includes("rate limit") ||
            errMsg.toLowerCase().includes("daily")
          ) {
            hitQuotaDuringSend = true;
            break;
          }
          perSubStatus.set(item.sub.id, {
            status: "FAILED",
            error: errMsg,
          });
        } else {
          notifiedCount++;
          perSubStatus.set(item.sub.id, { status: "SENT" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown Resend error";
        errors.push(`${item.sub.email}: ${msg}`);
        if (
          msg.toLowerCase().includes("quota") ||
          msg.toLowerCase().includes("rate limit")
        ) {
          hitQuotaDuringSend = true;
          break;
        }
        perSubStatus.set(item.sub.id, { status: "FAILED", error: msg });
      }
    }
  } else {
    notifiedCount = targetSubs.length;
    for (const item of renderedEmails) {
      perSubStatus.set(item.sub.id, { status: "SIMULATED" });
    }
  }

  const now = new Date();
  const attemptedItems = renderedEmails.filter((item) =>
    perSubStatus.has(item.sub.id)
  );

  // Update subscriptions & create NotificationLogs inside a transaction
  if (attemptedItems.length > 0) {
    await prisma.$transaction(
      attemptedItems.flatMap((item) => {
        const outcome = perSubStatus.get(item.sub.id) || {
          status: "SIMULATED",
        };
        const isOk =
          outcome.status === "SENT" || outcome.status === "SIMULATED";
        return [
          prisma.waitlistSubscription.update({
            where: { id: item.sub.id },
            data: {
              status: isOk ? "NOTIFIED" : "PENDING",
              notifiedAt: isOk ? now : null,
            },
          }),
          prisma.notificationLog.create({
            data: {
              shopId: shop.id,
              subscriptionId: item.sub.id,
              recipientEmail: item.sub.email,
              productTitle: item.sub.productTitle,
              variantTitle: item.sub.variantTitle,
              subject: item.subject,
              deliveryStatus: outcome.status,
              errorMessage: outcome.error || null,
              htmlPreview: item.html,
            },
          }),
        ];
      })
    );
  }

  const totalQueuedRemaining =
    queuedSubsCount + (targetSubs.length - attemptedItems.length);

  return {
    notifiedCount,
    queuedCount: totalQueuedRemaining,
    quotaExceeded: usage.isQuotaExceeded || hitQuotaDuringSend,
    mode: isLiveResend ? "RESEND_LIVE" : "SIMULATED",
    errors,
    message:
      totalQueuedRemaining > 0
        ? `${notifiedCount} varsler sendt. ${totalQueuedRemaining} abonnenter venter i kø til neste dags kvote.`
        : undefined,
  };
}
