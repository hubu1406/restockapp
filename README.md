# RestockPulse 🔔

A lightweight, high-performance Back in Stock (Restock Alert) notification system for Shopify stores, powered by Next.js, Prisma, and Resend.

## Features
- **Instant Email Alerts**: Dispatches automated back-in-stock notifications via Resend API when products are restocked.
- **Shopify Venture (1.0) & 2.0 Compatible**: Custom storefront widget designed specifically for Shopify themes (including legacy themes with variant select observers).
- **Merchant Dashboard**: Real-time demand tracking, most-requested out-of-stock variants, subscriber management with CSV export, and email preview.
- **Norwegian & Multi-Language Support**: Fully customizable widget and email templates directly from the dashboard.
- **Webhook Integration**: Listens to Shopify `products/update` webhooks with HMAC signature verification.

## Tech Stack
- **Framework**: Next.js 15 (App Router), React 19
- **Database**: Prisma ORM (SQLite for local development, Neon / PostgreSQL ready for production)
- **Email Service**: [Resend](https://resend.com)
- **Styling**: Tailwind CSS v4, Lucide Icons

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

```env
DATABASE_URL="file:./dev.db"
DEFAULT_SHOP_DOMAIN="your-store.myshopify.com"
SHOPIFY_WEBHOOK_SECRET="your_shopify_webhook_secret"
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="PakkLett <noreply@pakklett.no>"
```

### 3. Initialize Database & Run Locally
```bash
npx prisma db push
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the merchant dashboard.

## Shopify Theme Integration
1. Copy `shopify-theme/back-in-stock-widget.liquid` into your theme's `snippets/` directory.
2. Include the snippet in `layout/theme.liquid` before `</body>`:
```liquid
{% if template contains 'product' %}
  {% include 'back-in-stock-widget' %}
{% endif %}
```
