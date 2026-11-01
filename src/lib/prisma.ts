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

    // Seed sample waitlist subscriptions if this is the default shop on first run
    const existingCount = await prisma.waitlistSubscription.count({
      where: { shopId: shop.id },
    });

    if (existingCount === 0) {
      await prisma.waitlistSubscription.createMany({
        data: [
          {
            shopId: shop.id,
            productId: "gid://shopify/Product/8901234567001",
            variantId: "44001122334001",
            productTitle: "Merino Wool Oversized Crewneck",
            variantTitle: "Charcoal / Medium",
            productHandle: "merino-wool-oversized-crewneck",
            productUrl: `https://${domain}/products/merino-wool-oversized-crewneck?variant=44001122334001`,
            imageUrl:
              "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=600&q=80",
            price: "1280",
            sku: "MW-CHR-M",
            email: "emma.wilson@example.com",
            acceptsMarketing: false,
            status: "PENDING",
          },
          {
            shopId: shop.id,
            productId: "gid://shopify/Product/8901234567001",
            variantId: "44001122334001",
            productTitle: "Merino Wool Oversized Crewneck",
            variantTitle: "Charcoal / Medium",
            productHandle: "merino-wool-oversized-crewneck",
            productUrl: `https://${domain}/products/merino-wool-oversized-crewneck?variant=44001122334001`,
            imageUrl:
              "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=600&q=80",
            price: "1280",
            sku: "MW-CHR-M",
            email: "liam.chen@example.com",
            acceptsMarketing: false,
            status: "PENDING",
          },
          {
            shopId: shop.id,
            productId: "gid://shopify/Product/8901234567001",
            variantId: "44001122334001",
            productTitle: "Merino Wool Oversized Crewneck",
            variantTitle: "Charcoal / Medium",
            productHandle: "merino-wool-oversized-crewneck",
            productUrl: `https://${domain}/products/merino-wool-oversized-crewneck?variant=44001122334001`,
            imageUrl:
              "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=600&q=80",
            price: "1280",
            sku: "MW-CHR-M",
            email: "sofia.martinez@example.com",
            acceptsMarketing: false,
            status: "PENDING",
          },
          {
            shopId: shop.id,
            productId: "gid://shopify/Product/8901234567002",
            variantId: "44001122334002",
            productTitle: "Artisan Ceramic Pour-Over Set",
            variantTitle: "Matte Sand / 600ml",
            productHandle: "artisan-ceramic-pour-over-set",
            productUrl: `https://${domain}/products/artisan-ceramic-pour-over-set?variant=44001122334002`,
            imageUrl:
              "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80",
            price: "640",
            sku: "CP-SND-600",
            email: "noah.patel@example.com",
            acceptsMarketing: false,
            status: "PENDING",
          },
          {
            shopId: shop.id,
            productId: "gid://shopify/Product/8901234567002",
            variantId: "44001122334002",
            productTitle: "Artisan Ceramic Pour-Over Set",
            variantTitle: "Matte Sand / 600ml",
            productHandle: "artisan-ceramic-pour-over-set",
            productUrl: `https://${domain}/products/artisan-ceramic-pour-over-set?variant=44001122334002`,
            imageUrl:
              "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80",
            price: "640",
            sku: "CP-SND-600",
            email: "olivia.kim@example.com",
            acceptsMarketing: false,
            status: "PENDING",
          },
          {
            shopId: shop.id,
            productId: "gid://shopify/Product/8901234567003",
            variantId: "44001122334003",
            productTitle: "Minimalist Leather Weekender Bag",
            variantTitle: "Cognac Brown",
            productHandle: "minimalist-leather-weekender-bag",
            productUrl: `https://${domain}/products/minimalist-leather-weekender-bag?variant=44001122334003`,
            imageUrl:
              "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=600&q=80",
            price: "2950",
            sku: "LW-COG-01",
            email: "lucas.meyer@example.com",
            acceptsMarketing: false,
            status: "NOTIFIED",
            notifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
          },
        ],
      });
    }
  }

  return shop;
}
