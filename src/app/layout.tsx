import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RestockPulse — Shopify Back In Stock & Restock Alerts",
  description:
    "Automated Back in Stock waitlist, Shopify inventory webhook listener, and Resend batch email alerts.",
  icons: {
    icon: "/icon",
    apple: "/apple-icon",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const apiKey =
    process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ||
    process.env.SHOPIFY_CLIENT_ID ||
    "e1105c5d05fe8a2e2b4ebda209e2a24d";

  return (
    <html lang="en">
      <head>
        <meta name="shopify-api-key" content={apiKey} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
