import { NextRequest, NextResponse } from "next/server";
import { processRestockQueue } from "@/lib/queue-processor";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/process-queue
 * Invoked daily by Vercel Cron at 08:00 UTC (09:00 CET/CEST).
 * Checks remaining Resend quota for the store and continues sending
 * notifications to any PENDING waitlist subscribers for items currently in stock.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    // If CRON_SECRET is configured in environment, verify Vercel cron token
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing CRON_SECRET" },
        { status: 401 }
      );
    }

    const shopDomain = req.nextUrl.searchParams.get("shop") || undefined;
    const result = await processRestockQueue(shopDomain);

    return NextResponse.json({
      cron: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Cron process queue error:", error);
    return NextResponse.json(
      {
        cron: false,
        error: error instanceof Error ? error.message : "Internal Cron Error",
      },
      { status: 500 }
    );
  }
}
