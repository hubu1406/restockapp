import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RestockPulse — Shopify Back In Stock & Restock Alerts",
  description:
    "Automated Back in Stock waitlist, Shopify inventory webhook listener, and Resend batch email alerts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
