import { getOrCreateShop, prisma } from "./prisma";
import {
  dispatchBackInStockNotifications,
  getDailyEmailUsage,
  DailyEmailUsage,
} from "./email";

export interface ProcessQueueResult {
  ok: boolean;
  message: string;
  processedCount: number;
  queuedCount: number;
  usage: DailyEmailUsage;
  notifiedVariants: string[];
  errors: string[];
}

/**
 * Automatically resumes sending back-in-stock notifications to PENDING subscribers
 * for variants that are currently in stock on the store, strictly honoring
 * the daily Resend quota limit (95 emails/day).
 *
 * Called daily by Vercel Cron at 08:00 UTC (09:00 Norwegian time)
 * or triggered manually by merchant from the RestockPulse dashboard.
 */
export async function processRestockQueue(
  shopDomain?: string
): Promise<ProcessQueueResult> {
  const shop = await getOrCreateShop(shopDomain);
  const usage = await getDailyEmailUsage(shop.id);

  if (usage.isQuotaExceeded || usage.remaining <= 0) {
    return {
      ok: true,
      message: `Dagsgrensen på ${usage.limit} e-poster er nådd (0 gjenstår i dag). Utsending fortsetter automatisk i morgen kl. 09:00.`,
      processedCount: 0,
      queuedCount: 0,
      usage,
      notifiedVariants: [],
      errors: [],
    };
  }

  // 1. Fetch live products from store to identify variants currently in-stock
  const inStockVariantIds = new Set<string>();
  try {
    const catalogUrl = `https://${shop.shopDomain}/products.json?limit=250`;
    const response = await fetch(catalogUrl, {
      headers: { "User-Agent": "RestockPulse-QueueWorker/1.0" },
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();
      const products = Array.isArray(data.products) ? data.products : [];
      for (const p of products) {
        if (Array.isArray(p.variants)) {
          for (const v of p.variants) {
            if (v.available === true) {
              inStockVariantIds.add(String(v.id));
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to fetch live catalog in queue processor:", err);
  }

  // 2. Fetch all PENDING subscribers ordered by oldest subscription first (FIFO)
  const pendingSubs = await prisma.waitlistSubscription.findMany({
    where: {
      shopId: shop.id,
      status: "PENDING",
    },
    orderBy: { createdAt: "asc" },
  });

  if (pendingSubs.length === 0) {
    return {
      ok: true,
      message: "Ingen ventende abonnenter i køen.",
      processedCount: 0,
      queuedCount: 0,
      usage,
      notifiedVariants: [],
      errors: [],
    };
  }

  // 3. Filter only subscribers whose requested variant is currently in stock
  const eligibleSubs = pendingSubs.filter((sub) =>
    inStockVariantIds.has(sub.variantId)
  );

  if (eligibleSubs.length === 0) {
    return {
      ok: true,
      message: `Fant ${pendingSubs.length} ventende abonnenter, men ingen av de etterspurte produktene er på lager for øyeblikket.`,
      processedCount: 0,
      queuedCount: pendingSubs.length,
      usage,
      notifiedVariants: [],
      errors: [],
    };
  }

  // 4. Take up to remaining daily quota
  const batchToSend = eligibleSubs.slice(0, usage.remaining);
  const remainingQueued = eligibleSubs.length - batchToSend.length;

  const result = await dispatchBackInStockNotifications(shop, batchToSend);

  const updatedUsage = await getDailyEmailUsage(shop.id);
  const notifiedVariants = Array.from(
    new Set(batchToSend.map((s) => `${s.productTitle} (${s.variantTitle})`))
  );

  return {
    ok: true,
    message:
      result.notifiedCount > 0
        ? `Sendte ${result.notifiedCount} varsler for varer på lager. ${
            remainingQueued > 0
              ? `${remainingQueued} abonnenter venter til neste dags kvote.`
              : "Køen for tilgjengelige varer er nå fullført."
          }`
        : "Ingen varsler ble sendt.",
    processedCount: result.notifiedCount,
    queuedCount: remainingQueued + (pendingSubs.length - eligibleSubs.length),
    usage: updatedUsage,
    notifiedVariants,
    errors: result.errors,
  };
}
