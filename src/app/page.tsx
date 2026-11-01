"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Bell,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Flame,
  Inbox,
  Layers,
  Loader2,
  Lock,
  Mail,
  PackageCheck,
  Palette,
  Play,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

interface ShopSettings {
  id: string;
  shopDomain: string;
  shopName: string;
  buttonText: string;
  buttonBgColor: string;
  buttonTextColor: string;
  modalTitle: string;
  modalSubtitle: string;
  modalSubmitText: string;
  successMessage: string;
  showMarketingOptIn: boolean;
  emailSenderName: string;
  emailReplyTo: string | null;
  emailSubject: string;
  emailHeading: string;
  emailBodyText: string;
  emailButtonText: string;
  emailAccentColor: string;
}

interface TopVariant {
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

interface Subscription {
  id: string;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string;
  price: string;
  sku: string | null;
  email: string;
  acceptsMarketing: boolean;
  status: string;
  createdAt: string;
  notifiedAt: string | null;
}

interface NotificationLogItem {
  id: string;
  recipientEmail: string;
  productTitle: string;
  variantTitle: string;
  subject: string;
  deliveryStatus: string;
  errorMessage: string | null;
  htmlPreview: string | null;
  createdAt: string;
}

interface DashboardData {
  shop: ShopSettings;
  kpis: {
    totalSubscriptions: number;
    pendingCount: number;
    notifiedCount: number;
    convertedCount: number;
    pendingRevenuePotential: string;
  };
  topVariants: TopVariant[];
  subscriptions: Subscription[];
  notificationLogs: NotificationLogItem[];
  sampleEmailPreview: {
    subject: string;
    html: string;
  };
  environment: {
    isLiveResendConfigured: boolean;
    hasWebhookSecret: boolean;
  };
}

const DEMO_PRODUCTS = [
  {
    productId: "8439791386815",
    variantId: "45660467953855",
    productTitle: "IceFlame NXT dunquilt - fra 324g",
    variantTitle: "NXT Summer 15°C 194x124cm 324g 800FP",
    productHandle: "iceflame-nxt-dunquilt-fra-324g",
    imageUrl:
      "https://pakklett.no/cdn/shop/files/imgi_95_semi-nxt.png?v=1719875440&width=600",
    price: "1890.00",
    sku: "NXT_SUMMER_850",
    available: false,
  },
  {
    productId: "8439791386815",
    variantId: "45660468019391",
    productTitle: "IceFlame NXT dunquilt - fra 324g",
    variantTitle: "NXT L 5°C 194x134cm 585g 850FP",
    productHandle: "iceflame-nxt-dunquilt-fra-324g",
    imageUrl:
      "https://pakklett.no/cdn/shop/files/imgi_95_semi-nxt.png?v=1719875440&width=600",
    price: "2799.00",
    sku: "NXT_QUILT_L_850FP",
    available: false,
  },
];

export default function BackInStockDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "overview" | "subscribers" | "widget" | "email" | "setup"
  >("overview");

  // Filters for subscribers tab
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Action states
  const [restockingVariantId, setRestockingVariantId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Editable form state for Widget & Email settings
  const [formSettings, setFormSettings] = useState<ShopSettings | null>(null);

  // Storefront Simulator state
  const [simSelectedIdx, setSimSelectedIdx] = useState(0);
  const [simModalOpen, setSimModalOpen] = useState(false);
  const [simEmail, setSimEmail] = useState("");
  const [simOptIn, setSimOptIn] = useState(true);
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simSuccessMsg, setSimSuccessMsg] = useState<string | null>(null);

  // Email HTML Modal inspection state
  const [inspectedLog, setInspectedLog] = useState<NotificationLogItem | null>(null);

  // Shopify App Bridge Auth State
  const [unauthorized, setUnauthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isInsideShopify, setIsInsideShopify] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const getAuthHeaders = async (maxAttempts = 12): Promise<Record<string, string>> => {
    if (typeof window === "undefined") return {};

    const inShopify =
      window.self !== window.top ||
      window.location.search.includes("shop=") ||
      window.location.search.includes("host=");

    const anyWindow = window as unknown as { shopify?: { idToken?: () => Promise<string> } };

    // If inside Shopify Admin, poll until App Bridge is loaded (up to 2.4s)
    const attempts = inShopify ? maxAttempts : 1;
    for (let i = 0; i < attempts; i++) {
      if (anyWindow.shopify?.idToken) {
        try {
          const token = await anyWindow.shopify.idToken();
          if (token) {
            return { Authorization: `Bearer ${token}` };
          }
        } catch (err) {
          console.warn(`[RestockPulse] idToken attempt ${i + 1} failed:`, err);
        }
      }
      if (inShopify && i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return {};
  };

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const inShopify =
        typeof window !== "undefined" &&
        (window.self !== window.top ||
          window.location.search.includes("shop=") ||
          window.location.search.includes("host="));
      setIsInsideShopify(Boolean(inShopify));

      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/dashboard", {
        headers: { ...authHeaders },
      });

      if (res.status === 401) {
        const errJson = await res.json().catch(() => ({}));
        setAuthError(errJson.error || "401 Unauthorized");
        setUnauthorized(true);
        return;
      }

      const json = await res.json();
      if (res.ok) {
        setData(json);
        setFormSettings((prev) => prev ?? json.shop);
        setUnauthorized(false);
        setAuthError(null);
      } else {
        setUnauthorized(true);
        setAuthError(json.error || "Kunne ikke hente dashbordet.");
      }
    } catch (e) {
      console.error("Dashboard fetch failed:", e);
      setUnauthorized(true);
      setAuthError("Nettverksfeil ved lasting av dashbord.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const handleSimulateRestock = async (variantId: string, productTitle: string) => {
    setRestockingVariantId(variantId);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          action: "trigger_restock",
          variantId,
          inventoryQuantity: 15,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        showToast(
          result.notifiedCount > 0
            ? `Sent ${result.notifiedCount} Back-in-Stock email(s) for "${productTitle}" (${result.mode})!`
            : `No pending subscribers waiting for "${productTitle}".`
        );
        await fetchDashboard();
      }
    } finally {
      setRestockingVariantId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSettings) return;
    setSavingSettings(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          action: "update_settings",
          settings: formSettings,
        }),
      });
      if (res.ok) {
        showToast("Settings saved! Storefront widget & email template updated.");
        await fetchDashboard();
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSimulatorSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = DEMO_PRODUCTS[simSelectedIdx];
    if (!chosen || !simEmail) return;
    setSimSubmitting(true);
    setSimSuccessMsg(null);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: data?.shop.shopDomain,
          email: simEmail,
          productId: chosen.productId,
          variantId: chosen.variantId,
          productTitle: chosen.productTitle,
          variantTitle: chosen.variantTitle,
          productHandle: chosen.productHandle,
          imageUrl: chosen.imageUrl,
          price: chosen.price,
          sku: chosen.sku,
          acceptsMarketing: false,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        setSimSuccessMsg(result.message);
        setSimEmail("");
        showToast(`Added ${simEmail} to waitlist for ${chosen.productTitle}!`);
        await fetchDashboard();
      } else {
        showToast(result.error || "Subscription failed");
      }
    } finally {
      setSimSubmitting(false);
    }
  };

  const handleDeleteSub = async (id: string) => {
    const authHeaders = await getAuthHeaders();
    await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ action: "delete_subscription", subscriptionId: id }),
    });
    showToast("Subscription removed.");
    await fetchDashboard();
  };

  const handleResetToPending = async (id: string) => {
    const authHeaders = await getAuthHeaders();
    await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ action: "reset_to_pending", subscriptionId: id }),
    });
    showToast("Subscriber reset to PENDING so you can test restock alerts again.");
    await fetchDashboard();
  };

  const handleExportCsv = () => {
    if (!data) return;
    const headers = [
      "Email",
      "Status",
      "Product Title",
      "Variant Title",
      "Variant ID",
      "SKU",
      "Price",
      "Marketing Opt-In",
      "Subscribed At",
      "Notified At",
    ];
    const rows = data.subscriptions.map((s) => [
      s.email,
      s.status,
      `"${s.productTitle.replace(/"/g, '""')}"`,
      `"${s.variantTitle.replace(/"/g, '""')}"`,
      s.variantId,
      s.sku || "",
      s.price,
      s.acceptsMarketing ? "Yes" : "No",
      new Date(s.createdAt).toISOString(),
      s.notifiedAt ? new Date(s.notifiedAt).toISOString() : "",
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `waitlist-subscribers-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!loading && (unauthorized || !data)) {
    const shopAdminUrl = "https://admin.shopify.com/store/muskox/apps/restockpulse";
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl text-center border border-slate-100">
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-5 text-amber-600 shadow-inner">
            <Lock className="w-8 h-8" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 mb-3">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            Adgangskontroll
          </span>

          <h1 className="text-2xl font-extrabold text-slate-900 mb-2">
            {isInsideShopify ? "Autentiseringsfeil" : "Beskyttet dashbord"}
          </h1>

          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            {isInsideShopify
              ? authError ||
                "Venter på autorisasjon fra Shopify. Dersom du nettopp la til miljøvariablene i Vercel, må prosjektet bygges på nytt."
              : "RestockPulse inneholder sensitive kundelister og e-postinnstillinger for pakklett.no. Dette dashbordet er sikret og kan kun åpnes fra innsiden av Shopify Admin."}
          </p>

          {isInsideShopify ? (
            <button
              onClick={() => fetchDashboard()}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#2D2A38] hover:bg-[#3D384D] text-white font-bold py-3.5 px-6 rounded-xl transition duration-150 shadow-md hover:shadow-lg cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Prøv igjen</span>
            </button>
          ) : (
            <a
              href={shopAdminUrl}
              target="_top"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 bg-[#2D2A38] hover:bg-[#3D384D] text-white font-bold py-3.5 px-6 rounded-xl transition duration-150 shadow-md hover:shadow-lg"
            >
              <span>Åpne i Shopify Admin</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-xs text-slate-400">
              Autentisering:{" "}
              <span className="font-mono text-slate-600">Shopify App Bridge Session Token</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !data || !formSettings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <p className="text-sm font-medium text-slate-600">
            Loading RestockPulse Shopify Merchant Dashboard...
          </p>
        </div>
      </div>
    );
  }

  const filteredSubscriptions = data.subscriptions.filter((sub) => {
    const matchesStatus = statusFilter === "ALL" ? true : sub.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesQuery =
      !q ||
      sub.email.toLowerCase().includes(q) ||
      sub.productTitle.toLowerCase().includes(q) ||
      sub.variantTitle.toLowerCase().includes(q) ||
      (sub.sku && sub.sku.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  const simProduct = DEMO_PRODUCTS[simSelectedIdx];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Toast Notification Banner */}
      {toastMessage ? (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 text-sm font-medium animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      ) : null}

      {/* Top Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900 tracking-tight">
                  RestockPulse
                </h1>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Back In Stock Alerts
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Connected Store:{" "}
                <span className="font-medium text-slate-700">{data.shop.shopDomain}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`hidden sm:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border ${
                data.environment.isLiveResendConfigured
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-800 border-amber-200"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  data.environment.isLiveResendConfigured ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {data.environment.isLiveResendConfigured
                ? "Resend Live Email Active"
                : "Email Simulator Mode (Add RESEND_API_KEY for live send)"}
            </div>

            <button
              onClick={() => {
                setActiveTab("widget");
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Test Storefront Widget
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto border-t border-slate-100">
          {[
            { id: "overview", label: "Demand & Overview", icon: TrendingUp },
            {
              id: "subscribers",
              label: `Waitlist Subscribers (${data.kpis.totalSubscriptions})`,
              icon: Users,
            },
            { id: "widget", label: "Widget Customizer & Simulator", icon: Palette },
            {
              id: "email",
              label: `Email Template & Logs (${data.notificationLogs.length})`,
              icon: Mail,
            },
            { id: "setup", label: "Shopify & Vercel Setup", icon: Code2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition cursor-pointer ${
                  isActive
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* TAB 1: OVERVIEW & MOST REQUESTED VARIANTS */}
        {activeTab === "overview" ? (
          <div className="space-y-8">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Waiting Subscribers
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                    <Inbox className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 text-3xl font-extrabold text-slate-900">
                  {data.kpis.pendingCount}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Active customers awaiting restock
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Waitlist Revenue Value
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 text-3xl font-extrabold text-emerald-600">
                  ${data.kpis.pendingRevenuePotential}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Potential revenue from pending alerts
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Restock Emails Sent
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Send className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 text-3xl font-extrabold text-slate-900">
                  {data.kpis.notifiedCount}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Instant notifications dispatched
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Tracked Variants
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 text-3xl font-extrabold text-slate-900">
                  {data.topVariants.length}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Out-of-stock SKUs with demand
                </p>
              </div>
            </div>

            {/* Most Requested Variants Leaderboard */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-orange-500" />
                    <h2 className="text-lg font-bold text-slate-900">
                      Most Requested Out-of-Stock Variants
                    </h2>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Prioritize your inventory restocks based on real customer waitlist demand. Click{" "}
                    <strong>Simulate Restock</strong> to test the email notification engine now.
                  </p>
                </div>
                <button
                  onClick={fetchDashboard}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer self-start"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="py-3.5 px-6">Product & Variant</th>
                      <th className="py-3.5 px-4">SKU / Variant ID</th>
                      <th className="py-3.5 px-4">Unit Price</th>
                      <th className="py-3.5 px-4">Waiting Subscribers</th>
                      <th className="py-3.5 px-4">Potential Revenue</th>
                      <th className="py-3.5 px-6 text-right">Restock Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {data.topVariants.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 px-6 text-center text-slate-500">
                          <PackageCheck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                          <p className="font-semibold text-slate-700">Ingen ventelister aktive ennå</p>
                          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                            Når kunder på pakklett.no klikker på «Varsle meg når på lager» for utsolgte varer, vises de her automatisk.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      data.topVariants.map((item) => (
                      <tr key={item.variantId} className="hover:bg-slate-50/80 transition">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3.5">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.productTitle}
                                className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                                <ShoppingBag className="w-5 h-5" />
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-slate-900">
                                {item.productTitle}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                Variant: <span className="font-medium text-slate-700">{item.variantTitle}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="text-xs font-mono text-slate-700">
                            {item.sku || "No SKU"}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            #{item.variantId}
                          </div>
                        </td>
                        <td className="py-4 px-4 font-semibold text-slate-900">
                          ${item.price}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                                item.pendingSubscribers > 0
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {item.pendingSubscribers} waiting
                            </span>
                            {item.notifiedSubscribers > 0 ? (
                              <span className="text-xs text-slate-400">
                                ({item.notifiedSubscribers} notified)
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-4 px-4 font-bold text-emerald-600">
                          ${item.potentialRevenue.toFixed(2)}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            disabled={
                              item.pendingSubscribers === 0 ||
                              restockingVariantId === item.variantId
                            }
                            onClick={() =>
                              handleSimulateRestock(item.variantId, item.productTitle)
                            }
                            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                              item.pendingSubscribers > 0
                                ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs"
                                : "bg-slate-100 text-slate-400 cursor-not-allowed"
                            }`}
                          >
                            {restockingVariantId === item.variantId ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Sending...
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                Simulate Restock & Notify ({item.pendingSubscribers})
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {/* TAB 2: SUBSCRIBERS LIST */}
        {activeTab === "subscribers" ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Customer Waitlist Subscriptions
                </h2>
                <p className="text-sm text-slate-500">
                  All customers who requested an email alert for out-of-stock variants.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search email or product..."
                    className="pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white font-medium text-slate-700"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">Pending Only</option>
                  <option value="NOTIFIED">Notified Only</option>
                </select>
                <button
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3.5 px-6">Customer Email</th>
                    <th className="py-3.5 px-4">Product & Variant</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Marketing</th>
                    <th className="py-3.5 px-4">Requested</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredSubscriptions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/80">
                      <td className="py-4 px-6 font-medium text-slate-900">
                        {sub.email}
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-semibold text-slate-800">
                          {sub.productTitle}
                        </div>
                        <div className="text-xs text-slate-500">
                          {sub.variantTitle} • ${sub.price}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            sub.status === "PENDING"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {sub.status}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-xs text-slate-600">
                        {sub.acceptsMarketing ? "Opted In" : "Alert Only"}
                      </td>
                      <td className="py-4 px-4 text-xs text-slate-500">
                        {new Date(sub.createdAt).toLocaleString()}
                      </td>
                      <td className="py-4 px-6 text-right space-x-2">
                        {sub.status !== "PENDING" ? (
                          <button
                            onClick={() => handleResetToPending(sub.id)}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
                          >
                            Reset to Pending
                          </button>
                        ) : null}
                        <button
                          onClick={() => handleDeleteSub(sub.id)}
                          className="text-slate-400 hover:text-rose-600 transition cursor-pointer p-1"
                          title="Delete subscription"
                        >
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* TAB 3: WIDGET CUSTOMIZER & INTERACTIVE STOREFRONT SIMULATOR */}
        {activeTab === "widget" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Widget Customizer Form */}
            <form
              onSubmit={handleSaveSettings}
              className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5 self-start"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Storefront Widget Styling
                  </h2>
                  <p className="text-xs text-slate-500">
                    Customize the &ldquo;Notify Me&rdquo; button & popup modal on your Shopify product pages.
                  </p>
                </div>
                <Settings className="w-5 h-5 text-slate-400" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product Page Button Label
                </label>
                <input
                  type="text"
                  value={formSettings.buttonText}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, buttonText: e.target.value })
                  }
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Button Background
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formSettings.buttonBgColor}
                      onChange={(e) =>
                        setFormSettings({ ...formSettings, buttonBgColor: e.target.value })
                      }
                      className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formSettings.buttonBgColor}
                      onChange={(e) =>
                        setFormSettings({ ...formSettings, buttonBgColor: e.target.value })
                      }
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Button Text Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formSettings.buttonTextColor}
                      onChange={(e) =>
                        setFormSettings({ ...formSettings, buttonTextColor: e.target.value })
                      }
                      className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formSettings.buttonTextColor}
                      onChange={(e) =>
                        setFormSettings({ ...formSettings, buttonTextColor: e.target.value })
                      }
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Popup Modal Heading
                </label>
                <input
                  type="text"
                  value={formSettings.modalTitle}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, modalTitle: e.target.value })
                  }
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Popup Modal Subtitle
                </label>
                <textarea
                  rows={2}
                  value={formSettings.modalSubtitle}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, modalSubtitle: e.target.value })
                  }
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Submit Button Text
                </label>
                <input
                  type="text"
                  value={formSettings.modalSubmitText}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, modalSubmitText: e.target.value })
                  }
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <button
                type="submit"
                disabled={savingSettings}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition cursor-pointer"
              >
                {savingSettings ? "Saving Changes..." : "Save Widget Settings"}
              </button>
            </form>

            {/* Right Column: Live Interactive Shopify Product Page Simulator */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
                      Interactive Storefront Preview
                    </span>
                    <h3 className="text-base font-bold text-slate-900">
                      Live Shopify Product Page Simulator
                    </h3>
                  </div>
                  <div className="flex gap-1.5">
                    {DEMO_PRODUCTS.map((p, idx) => (
                      <button
                        key={p.variantId}
                        type="button"
                        onClick={() => {
                          setSimSelectedIdx(idx);
                          setSimModalOpen(false);
                          setSimSuccessMsg(null);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          simSelectedIdx === idx
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        Item {idx + 1} ({p.available ? "In Stock" : "Sold Out"})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Simulated Product Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
                  <img
                    src={simProduct.imageUrl}
                    alt={simProduct.productTitle}
                    className="w-full h-64 object-cover rounded-xl border border-slate-200"
                  />
                  <div className="space-y-4">
                    <div>
                      <span
                        className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                          simProduct.available
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {simProduct.available ? "In Stock" : "Sold Out"}
                      </span>
                      <h4 className="text-xl font-bold text-slate-900 mt-2">
                        {simProduct.productTitle}
                      </h4>
                      <p className="text-lg font-extrabold text-slate-800 mt-1">
                        ${simProduct.price}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                      Selected Variant: <strong className="text-slate-900">{simProduct.variantTitle}</strong>
                    </div>

                    {/* Shopify Native Add to Cart Button */}
                    <button
                      type="button"
                      disabled={!simProduct.available}
                      className={`w-full py-3 px-4 rounded-xl text-sm font-semibold border ${
                        simProduct.available
                          ? "bg-white border-slate-900 text-slate-900"
                          : "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      {simProduct.available ? "Add to Cart" : "Sold Out"}
                    </button>

                    {/* RestockPulse Back In Stock Button (automatically shown when Sold Out) */}
                    {!simProduct.available ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSimSuccessMsg(null);
                          setSimModalOpen(true);
                        }}
                        style={{
                          backgroundColor: formSettings.buttonBgColor,
                          color: formSettings.buttonTextColor,
                        }}
                        className="w-full py-3.5 px-4 rounded-xl text-sm font-semibold shadow-sm hover:opacity-95 transition cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Bell className="w-4 h-4" />
                        {formSettings.buttonText}
                      </button>
                    ) : (
                      <p className="text-xs text-slate-400 italic text-center">
                        Switch to Item 1 or Item 2 above to see the &ldquo;Notify Me&rdquo; button appear on Sold Out variants.
                      </p>
                    )}
                  </div>
                </div>

                {/* Simulated Modal Overlay */}
                {simModalOpen ? (
                  <div className="inset-0 absolute bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-20">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 relative shadow-2xl border border-slate-100">
                      <button
                        type="button"
                        onClick={() => setSimModalOpen(false)}
                        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>

                      <h4 className="text-lg font-bold text-slate-900 pr-6">
                        {formSettings.modalTitle}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {formSettings.modalSubtitle}
                      </p>

                      <div className="mt-3 p-2.5 bg-slate-100 rounded-lg text-xs font-medium text-slate-800">
                        {simProduct.productTitle} — {simProduct.variantTitle}
                      </div>

                      {simSuccessMsg ? (
                        <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium text-center space-y-3">
                          <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                          <p>{simSuccessMsg}</p>
                          <button
                            type="button"
                            onClick={() => setSimModalOpen(false)}
                            className="text-xs font-semibold underline text-emerald-700 cursor-pointer"
                          >
                            Close preview
                          </button>
                        </div>
                      ) : (
                        <form onSubmit={handleSimulatorSubscribe} className="mt-4 space-y-3">
                          <input
                            type="email"
                            required
                            value={simEmail}
                            onChange={(e) => setSimEmail(e.target.value)}
                            placeholder="Skriv inn din e-postadresse..."
                            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                          />
                          <button
                            type="submit"
                            disabled={simSubmitting}
                            style={{
                              backgroundColor: formSettings.buttonBgColor,
                              color: formSettings.buttonTextColor,
                            }}
                            className="w-full py-3 rounded-xl text-sm font-semibold cursor-pointer"
                          >
                            {simSubmitting
                              ? "Registrerer..."
                              : formSettings.modalSubmitText}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* TAB 4: EMAIL TEMPLATE DESIGNER & DELIVERY LOGS */}
        {activeTab === "email" ? (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left: Email Template Settings */}
              <form
                onSubmit={handleSaveSettings}
                className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4 self-start"
              >
                <div className="border-b border-slate-100 pb-3">
                  <h2 className="text-base font-bold text-slate-900">
                    Back-In-Stock Email Template
                  </h2>
                  <p className="text-xs text-slate-500">
                    Supports variables: <code>{"{{product_title}}"}</code>,{" "}
                    <code>{"{{variant_title}}"}</code>, <code>{"{{price}}"}</code>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Sender Brand Name
                  </label>
                  <input
                    type="text"
                    value={formSettings.emailSenderName}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        emailSenderName: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Subject Line
                  </label>
                  <input
                    type="text"
                    value={formSettings.emailSubject}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, emailSubject: e.target.value })
                    }
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Headline
                  </label>
                  <input
                    type="text"
                    value={formSettings.emailHeading}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, emailHeading: e.target.value })
                    }
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Body Copy
                  </label>
                  <textarea
                    rows={3}
                    value={formSettings.emailBodyText}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, emailBodyText: e.target.value })
                    }
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      CTA Button Label
                    </label>
                    <input
                      type="text"
                      value={formSettings.emailButtonText}
                      onChange={(e) =>
                        setFormSettings({
                          ...formSettings,
                          emailButtonText: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Brand Accent Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={formSettings.emailAccentColor}
                        onChange={(e) =>
                          setFormSettings({
                            ...formSettings,
                            emailAccentColor: e.target.value,
                          })
                        }
                        className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formSettings.emailAccentColor}
                        onChange={(e) =>
                          setFormSettings({
                            ...formSettings,
                            emailAccentColor: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition cursor-pointer"
                >
                  {savingSettings ? "Saving..." : "Save & Refresh Email Preview"}
                </button>
              </form>

              {/* Right: Rendered HTML Email Preview */}
              <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-900">Subject Preview: </span>
                    {data.sampleEmailPreview.subject}
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                    Responsive HTML
                  </span>
                </div>
                <iframe
                  title="Back in Stock Email Preview"
                  srcDoc={data.sampleEmailPreview.html}
                  className="w-full h-[540px] border-0"
                />
              </div>
            </div>

            {/* Sent Notification Delivery Logs */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-6 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">
                  Dispatched Email Notification Logs
                </h3>
                <p className="text-xs text-slate-500">
                  Every restock email triggered via Shopify Webhooks or manual restock simulation.
                </p>
              </div>
              {data.notificationLogs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No emails dispatched yet. Go to the{" "}
                  <button
                    onClick={() => setActiveTab("overview")}
                    className="text-indigo-600 font-semibold underline cursor-pointer"
                  >
                    Demand & Overview
                  </button>{" "}
                  tab and click &ldquo;Simulate Restock & Notify&rdquo; on any variant!
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="py-3 px-6">Recipient</th>
                        <th className="py-3 px-4">Product & Variant</th>
                        <th className="py-3 px-4">Subject</th>
                        <th className="py-3 px-4">Delivery Mode</th>
                        <th className="py-3 px-4">Sent At</th>
                        <th className="py-3 px-6 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {data.notificationLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50">
                          <td className="py-3.5 px-6 font-medium text-slate-900">
                            {log.recipientEmail}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600">
                            <strong className="text-slate-800">{log.productTitle}</strong> (
                            {log.variantTitle})
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600">
                            {log.subject}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                log.deliveryStatus === "SENT"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : log.deliveryStatus === "SIMULATED"
                                    ? "bg-indigo-100 text-indigo-800"
                                    : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {log.deliveryStatus}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-500">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            {log.htmlPreview ? (
                              <button
                                onClick={() => setInspectedLog(log)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View Email
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* TAB 5: SHOPIFY & VERCEL FREE TIER INTEGRATION GUIDE */}
        {activeTab === "setup" ? (
          <div className="space-y-6 max-w-4xl">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5">
                <PackageCheck className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900">
                  Step 1: Add the Storefront Widget to Your Shopify Theme
                </h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                We generated a ready-to-paste Shopify Online Store 2.0 snippet at{" "}
                <code className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-xs">
                  shopify-theme/back-in-stock-widget.liquid
                </code>
                . In your Shopify Admin, go to <strong>Online Store &rarr; Themes &rarr; Edit Code</strong>:
              </p>
              <ol className="list-decimal list-inside text-sm text-slate-700 space-y-2">
                <li>
                  Create a new snippet named{" "}
                  <code className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-xs">
                    snippets/back-in-stock-widget.liquid
                  </code>{" "}
                  and paste the contents of <code>shopify-theme/back-in-stock-widget.liquid</code>.
                </li>
                <li>
                  Open <code>layout/theme.liquid</code> and paste this right before{" "}
                  <code>&lt;/body&gt;</code>:
                </li>
              </ol>
              <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto">
{`{% if template contains 'product' %}
  {% include 'back-in-stock-widget' %}
{% endif %}`}
              </pre>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5">
                <ExternalLink className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900">
                  Step 2: Connect the Shopify Restock Webhook
                </h2>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                So your app automatically sends emails the moment you restock a variant in Shopify Admin:
              </p>
              <ol className="list-decimal list-inside text-sm text-slate-700 space-y-2">
                <li>
                  In Shopify Admin, go to <strong>Settings &rarr; Notifications &rarr; Webhooks</strong>.
                </li>
                <li>
                  Click <strong>Create webhook</strong>:
                  <ul className="list-disc list-inside ml-5 mt-1 text-xs text-slate-600 space-y-1">
                    <li>
                      <strong>Event:</strong> <code>Product update</code> (<code>products/update</code>)
                    </li>
                    <li>
                      <strong>Format:</strong> <code>JSON</code>
                    </li>
                    <li>
                      <strong>URL:</strong>{" "}
                      <code>https://restockpulse.vercel.app/api/webhooks/shopify</code>
                    </li>
                  </ul>
                </li>
                <li>
                  Copy the <strong>Signing secret</strong> shown at the bottom of the Shopify Webhooks page and set it as{" "}
                  <code>SHOPIFY_WEBHOOK_SECRET</code> in your Vercel Environment Variables.
                </li>
              </ol>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5">
                <Copy className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900">
                  Step 3: Deploy on Vercel Free Tier (Neon Postgres + Resend)
                </h2>
              </div>
              <ul className="list-disc list-inside text-sm text-slate-700 space-y-2">
                <li>
                  <strong>Database:</strong> On Vercel, add the free <strong>Neon Postgres</strong> integration from the Vercel Marketplace, then change{" "}
                  <code>provider = &quot;sqlite&quot;</code> to{" "}
                  <code>provider = &quot;postgresql&quot;</code> in <code>prisma/schema.prisma</code>.
                </li>
                <li>
                  <strong>Emails:</strong> Create a free account at{" "}
                  <a
                    href="https://resend.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 underline"
                  >
                    resend.com
                  </a>{" "}
                  (3,000 free emails/month) and add <code>RESEND_API_KEY</code> and{" "}
                  <code>RESEND_FROM_EMAIL</code> in Vercel.
                </li>
              </ul>
            </div>
          </div>
        ) : null}
      </main>

      {/* Modal for Inspecting a Sent Email Log */}
      {inspectedLog ? (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <div className="text-xs font-bold text-slate-900">
                  To: {inspectedLog.recipientEmail}
                </div>
                <div className="text-xs text-slate-500">{inspectedLog.subject}</div>
              </div>
              <button
                onClick={() => setInspectedLog(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <iframe
              title="Sent Email Log Preview"
              srcDoc={inspectedLog.htmlPreview || ""}
              className="w-full h-[520px] border-0"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
