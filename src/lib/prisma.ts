import { PrismaClient, Shop } from "@prisma/client";

function resolveRuntimeDatabaseUrl(): string | undefined {
  return (
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL
  );
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: resolveRuntimeDatabaseUrl()
      ? {
          db: {
            url: resolveRuntimeDatabaseUrl(),
          },
        }
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const DEFAULT_SHOP_DOMAIN =
  process.env.DEFAULT_SHOP_DOMAIN || "pakklett.no";

/**
 * Ensures the Shop record exists (multi-tenant ready) and seeds initial sample data
 * if the database is brand new so the merchant can explore and test immediately.
 */
export async function getOrCreateShop(shopDomain?: string): Promise<Shop> {
  let domain = (shopDomain || DEFAULT_SHOP_DOMAIN).trim().toLowerCase();

  // Normalize Shopify internal permanent domain to custom store domain
  if (domain === "muskox.myshopify.com") {
    domain = "pakklett.no";
  }

  let shop = await prisma.shop.findUnique({
    where: { shopDomain: domain },
  });

  // If not found under pakklett.no, check if a record exists under muskox.myshopify.com and migrate it
  if (!shop && domain === "pakklett.no") {
    const legacyShop = await prisma.shop.findUnique({
      where: { shopDomain: "muskox.myshopify.com" },
    });
    if (legacyShop) {
      shop = await prisma.shop.update({
        where: { id: legacyShop.id },
        data: {
          shopDomain: "pakklett.no",
          shopName: "PakkLett",
          emailSenderName: "PakkLett",
          showMarketingOptIn: false,
        },
      });
    }
  }

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain: domain,
        shopName: "PakkLett",
        emailSenderName: "PakkLett",
        showMarketingOptIn: false,
      },
    });
  }

  return shop;
}
