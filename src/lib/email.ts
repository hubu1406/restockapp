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
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f3f4f6; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 500px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
          
          <!-- Brand Header -->
          <tr>
            <td style="padding: 20px 28px 10px; text-align: center;">
              <span style="font-size: 13px; font-weight: 700; color: #9ca3af; letter-spacing: 0.8px; text-transform: uppercase;">
                ${data.shop.emailSenderName || data.shop.shopName}
              </span>
            </td>
          </tr>

          <!-- Single Top Line: Tilbake på lager -->
          <tr>
            <td style="padding: 0 28px 14px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #111827; letter-spacing: -0.3px;">
                Tilbake på lager
              </h1>
            </td>
          </tr>

          <!-- Product Image right at the top -->
          ${imageBlock}

          <!-- Product Title, Price & Primary Action Link -->
          <tr>
            <td style="padding: 4px 28px 24px; text-align: center;">
              <h2 style="margin: 0 0 6px; font-size: 20px; font-weight: 700; color: #111827; line-height: 1.3;">
                ${data.productTitle}
              </h2>
              ${variantSubtitle}
              <div style="font-size: 19px; font-weight: 800; color: #111827; margin: 8px 0 20px;">
                ${data.price} kr
              </div>

              <!-- Primary CTA Link / Button -->
              <div style="margin-bottom: 24px;">
                <a href="${checkoutUrl}" style="display: inline-block; background-color: ${buttonColor}; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 40px; border-radius: 8px; letter-spacing: 0.2px; box-shadow: 0 2px 6px rgba(0,0,0,0.12);">
                  ${buttonText} &rarr;
                </a>
              </div>

              <!-- Other explanatory text placed after -->
              ${
                bodyText
                  ? `<div style="border-top: 1px solid #f3f4f6; padding-top: 18px; margin-top: 4px;">
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
}`;

  return { subject, html };
}

/**
 * Dispatches Back-in-Stock emails for a batch of PENDING subscriptions.
 * Designed for Vercel Free Tier: uses Resend API
 * and falls back to SIMULATED mode when RESEND_API_KEY is not configured yet.
 */
export async function dispatchBackInStockNotifications(
  shop: Shop,
  subscriptions: WaitlistSubscription[],
  inventoryAvailable?: number
): Promise<{
  notifiedCount: number;
  mode: "RESEND_LIVE" | "SIMULATED";
  errors: string[];
}> {
  if (subscriptions.length === 0) {
    return { notifiedCount: 0, mode: "SIMULATED", errors: [] };
  }

  // Smart batching: if inventory is known (e.g. 3 items restocked), optionally cap or notify up to 100 per batch
  const batchLimit =
    inventoryAvailable && inventoryAvailable > 0
      ? Math.min(subscriptions.length, Math.max(inventoryAvailable * 5, 25), 100)
      : Math.min(subscriptions.length, 100);

  const targetSubs = subscriptions.slice(0, batchLimit);
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const isLiveResend = Boolean(apiKey && apiKey.startsWith("re_") && apiKey !== "re_mock_mode");
  const fromAddress =
    process.env.RESEND_FROM_EMAIL || `${shop.emailSenderName || "PakkLett"} <noreply@pakklett.no>`;

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
  const perSubStatus = new Map<string, { status: "SENT" | "SIMULATED" | "FAILED"; error?: string }>();

  if (isLiveResend) {
    const resend = new Resend(apiKey);
    for (const item of renderedEmails) {
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
          errors.push(`${item.sub.email}: ${response.error.message}`);
          perSubStatus.set(item.sub.id, {
            status: "FAILED",
            error: response.error.message,
          });
        } else {
          notifiedCount++;
          perSubStatus.set(item.sub.id, { status: "SENT" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown Resend error";
        errors.push(`${item.sub.email}: ${msg}`);
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

  // Update subscriptions & create NotificationLogs inside a transaction
  await prisma.$transaction(
    renderedEmails.flatMap((item) => {
      const outcome = perSubStatus.get(item.sub.id) || { status: "SIMULATED" };
      const isOk = outcome.status === "SENT" || outcome.status === "SIMULATED";
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

  return {
    notifiedCount,
    mode: isLiveResend ? "RESEND_LIVE" : "SIMULATED",
    errors,
  };
}
