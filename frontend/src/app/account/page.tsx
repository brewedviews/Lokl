"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  Save, Package, MapPin, Plus, Trash2, Home as HomeIcon,
  TicketPercent, HelpCircle, Settings, ChevronRight, LogOut, Pencil, RotateCcw,
  Phone, Info, FileText, Shield, Truck, Copy, Check, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import type { ActiveCoupon } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { AddressSheet, type AddressFormValue as AddressForm } from "@/components/consumer/AddressSheet";
import type {
  Customer, CustomerAddress, Order,
} from "@/types";
const BLANK_ADDR: AddressForm = {
  name: "", phone: "", label: "Home", line1: "", landmark: "", city: "Bhilai", pincode: "",
  lat: null, lng: null,
};

function statusTone(s: string) {
  const x = (s || "").toLowerCase();
  if (x.includes("deliver") && !x.includes("pending")) return "text-emerald-700 bg-emerald-50";
  if (x.includes("cancel") || x.includes("reject")) return "text-rose-700 bg-rose-50";
  if (x.includes("complet")) return "text-[#E68910] bg-[#E68910]/10";
  return "text-[#0A1F5C] bg-[#0A1F5C]/10";
}

// G13 §14 — "support" is intentionally NOT a real panel state: the Support
// tile always hard-navigates to /account/support (see its onClick below),
// same as before. "legal" replaces the old always-rendered 7-row policy
// list with an on-demand panel, the same way every other tile already
// works — this is what actually shortens the page, not just tighter CSS.
type TileKey = "orders" | "addresses" | "coupons" | "profile" | "legal";
const VALID_TILES: TileKey[] = ["orders", "addresses", "coupons", "profile", "legal"];

// Legal/support pages — previously only linked from the dead, unimported
// Footer.tsx (Terms/Privacy) or not linked anywhere at all (the other 5).
// This list is their first reachable entry point in the app.
const POLICY_LINKS: { href: string; label: string; sub: string; icon: typeof Phone }[] = [
  { href: "/account/support?category=Fake+%2F+counterfeit+product", label: "Report a fake or counterfeit product", sub: "Tell us about a listing — we'll investigate", icon: ShieldAlert },
  { href: "/contact",        label: "Contact Us",                sub: "Reach our support team",        icon: Phone },
  { href: "/about",          label: "About Us",                  sub: "Our story and mission",          icon: Info },
  { href: "/faq",            label: "FAQs",                      sub: "Common questions, answered",     icon: HelpCircle },
  { href: "/terms",          label: "Terms & Conditions",        sub: "The rules of using Lokl",        icon: FileText },
  { href: "/privacy",        label: "Privacy Policy",            sub: "How we handle your data",        icon: Shield },
  { href: "/returns-policy", label: "Return & Exchange Policy",  sub: "Try & Buy, returns, refunds",    icon: RotateCcw },
  { href: "/shipping",       label: "Shipping Policy",           sub: "Delivery area, time and fees",   icon: Truck },
];

export default function CustomerAccountPage() {
  const sp = useSearchParams();
  const tabParam = sp.get("tab");
  const phone = useCustomerAuthStore((s) => s.phone) ?? "";
  const clearAuth = useCustomerAuthStore((s) => s.clearAuth);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [coupons, setCoupons] = useState<ActiveCoupon[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(true);
  const [form, setForm] = useState({ name: "", gender: "", dob: "", email: "" });
  const [addrModal, setAddrModal] = useState<(AddressForm & { id?: string }) | null>(null);
  const [activeTile, setActiveTile] = useState<TileKey>(VALID_TILES.includes(tabParam as TileKey) ? (tabParam as TileKey) : "orders");
  const [busy, setBusy] = useState(false);
  // True until the FIRST real fetch resolves (success or fail) — not until
  // `phone` merely exists, since `phone` itself comes from an async
  // Zustand rehydration and starts as "" for a tick even on a returning,
  // already-logged-in visitor. `load()` below only flips this to false
  // inside its own try/finally, so a `phone=""` render (rehydrating) and a
  // `phone` set but the fetch still in flight both stay in the loading
  // state — the real "0 orders / Welcome" defaults are never painted as
  // if they were genuine data.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tabParam && VALID_TILES.includes(tabParam as TileKey)) setActiveTile(tabParam as TileKey);
  }, [tabParam]);

  const load = useCallback(async () => {
    if (!phone) return; // still waiting on phone rehydration — stay loading
    try {
      const { customer, orders } = await api.customers.get(phone);
      setCustomer(customer);
      setOrders(orders);
      const c = customer as Customer & { age?: number; email?: string; gender?: string; date_of_birth?: string };
      setForm({ name: customer.name || "", gender: c.gender || "", dob: c.date_of_birth || "", email: c.email || "" });
    } catch {
      setCustomer({ id: "", phone, addresses: [] } as unknown as Customer);
    } finally {
      setLoading(false);
    }
  }, [phone]);

  useEffect(() => { void load(); }, [load]);

  // Real coupons only — no auth required, same public endpoint OffersCard
  // already uses on PDP/checkout (GET /api/coupons/active).
  useEffect(() => {
    let alive = true;
    api.catalog.activeCoupons(20)
      .then((c) => { if (alive) setCoupons(c); })
      .catch(() => { if (alive) setCoupons([]); })
      .finally(() => { if (alive) setCouponsLoading(false); });
    return () => { alive = false; };
  }, []);

  const saveProfile = async () => {
    if (!phone) return;
    setBusy(true);
    try {
      await api.customers.upsert({ phone, name: form.name, gender: form.gender || undefined, date_of_birth: form.dob || undefined, email: form.email });
      toast.success("Profile saved");
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const saveAddress = async (a: AddressForm) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("bf_customer_token") : null;
    if (!phone || !token) {
      toast.error("Please log in to add an address");
      setAddrModal(null);
      return;
    }
    if (!a.line1.trim() || !a.pincode.trim()) return toast.error("Address line & pincode are required");
    const cityNorm = (a.city || "").trim().toLowerCase();
    if (cityNorm && cityNorm !== "bhilai") return toast.error("Lokl currently serves Bhilai only");
    try {
      await api.customers.addAddress(phone, a);
      toast.success("Address saved");
      setAddrModal(null);
      void load();
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const removeAddress = async (aid: string) => {
    if (!window.confirm("Remove this address?")) return;
    await api.customers.removeAddress(phone, aid);
    void load();
  };

  const logout = async () => {
    if (!window.confirm("Sign out of this device?")) return;
    try { await apiClient.post("/api/auth/logout", {}); } catch { /* best-effort */ }
    try { localStorage.removeItem("bf_customer_token"); localStorage.removeItem("bf_customer_phone"); } catch { /* private-mode */ }
    clearAuth();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("customer-auth:change"));
    toast.success("Signed out");
    // Hard-reload /account so the layout re-evaluates auth and shows OTP form.
    // We use window.location instead of next/navigation router to also clear
    // any in-memory client-side cache (Order/Address pages were holding stale
    // state after a sign-out in the previous iteration).
    if (typeof window !== "undefined") window.location.assign("/account");
  };

  const addresses = customer?.addresses ?? [];

  // G13 §14 — real information-architecture rework, not a shrink of the
  // same 7 equal-weight tiles. Three visual tiers, in order:
  //   ACCOUNT (prominent, unchanged size/weight) -> orders/addresses/coupons
  //   SUPPORT (its own row) -> Help & Support, hard-navigates as before
  //   SETTINGS (compact list) -> Profile, Legal & Policies, Logout
  // Wishlist is intentionally not a tile here — it's already reachable from
  // the global header, so this row doesn't duplicate it. Wallet has no real
  // backend today and isn't part of the current product experience, so it
  // isn't exposed anywhere in this navigation.
  const accountTiles: Array<{ key: TileKey; label: string; icon: typeof Package; count: number }> = [
    { key: "orders", label: "Orders", icon: Package, count: orders.length },
    { key: "addresses", label: "Addresses", icon: MapPin, count: addresses.length },
    { key: "coupons", label: "Coupons", icon: TicketPercent, count: coupons.length },
  ];

  if (loading) return <AccountSkeleton />;

  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]">
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-8 pt-8">
        <section data-testid="profile-header-card" className="bg-white border border-[#E5E2DC] rounded-3xl p-4 sm:p-6 flex items-center gap-4 shadow-sm">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#1A2B4C] flex items-center justify-center shrink-0 border border-[#E5E2DC]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white" opacity="0.8">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
              <h2 className="text-lg sm:text-2xl font-display font-medium text-[#0A1F5C] leading-tight">{form.name || "Welcome"}</h2>
              <button data-testid="edit-profile-inline" onClick={() => setActiveTile("profile")} className="text-[#64748B] hover:text-[#0A1F5C] transition" aria-label="Edit profile">
                <Pencil size={14} />
              </button>
              <span className="bg-brand-accent/10 text-brand-accent px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Lokl Member</span>
            </div>
            <div className="text-sm text-[#64748B] mt-0.5">+{phone}</div>
          </div>
        </section>

        {/* ACCOUNT — kept prominent; Orders especially is an important
            post-purchase action. */}
        <SectionLabel>Account</SectionLabel>
        <section data-testid="quick-actions" className="grid grid-cols-3 gap-3 sm:gap-4">
          {accountTiles.map((t) => {
            const Icon = t.icon;
            const active = activeTile === t.key;
            return (
              <button
                key={t.key}
                type="button"
                data-testid={`tile-${t.key}`}
                aria-pressed={active}
                onClick={() => setActiveTile(t.key)}
                className={`relative bg-white rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center gap-2 transition-all
                  ${active ? "border-2 border-[#0A1F5C] bg-[#0A1F5C]/[0.04] shadow-md" : "border border-[#E5E2DC] hover:border-[#0A1F5C] hover:shadow-md"}`}
              >
                <Icon size={22} strokeWidth={1.6} className="text-[#0A1F5C]" />
                <span className="text-[11px] sm:text-xs font-semibold text-center leading-tight text-[#0A1F5C]">{t.label}</span>
                {t.count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-[#E68910] text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center rounded-full shadow-sm ring-2 ring-white">{t.count > 99 ? "99+" : t.count}</span>
                )}
              </button>
            );
          })}
        </section>

        {(activeTile === "orders" || activeTile === "addresses" || activeTile === "coupons") && (
          <section data-testid={`panel-${activeTile}`} className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm mt-4">
            {activeTile === "orders" && <OrdersPanel orders={orders} />}
            {activeTile === "addresses" && (
              <AddressesPanel
                addresses={addresses}
                onAdd={() => setAddrModal({ ...BLANK_ADDR, name: form.name, phone: phone.slice(-10) })}
                onRemove={removeAddress}
                phone={phone}
              />
            )}
            {activeTile === "coupons" && <CouponsPanel coupons={coupons} loading={couponsLoading} />}
          </section>
        )}

        {/* SUPPORT */}
        <SectionLabel>Support</SectionLabel>
        <button
          type="button"
          data-testid="tile-support"
          onClick={() => { window.location.href = "/account/support"; }}
          className="w-full flex items-center gap-3 bg-white border border-[#E5E2DC] hover:border-[#0A1F5C] rounded-2xl px-4 py-3.5 transition"
        >
          <div className="w-9 h-9 rounded-full bg-[#0A1F5C]/8 flex items-center justify-center shrink-0">
            <HelpCircle size={16} className="text-[#0A1F5C]" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-semibold text-[#0A1F5C]">Help &amp; Support</div>
            <div className="text-[11px] text-[#64748B]">Chat with us, track a ticket, or browse FAQs</div>
          </div>
          <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
        </button>

        {/* SETTINGS — Profile/Edit, Legal & Policies (the old always-on
            7-row list collapsed into one on-demand panel), Logout. */}
        <SectionLabel>Settings</SectionLabel>
        <section className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden divide-y divide-[#E5E2DC]" data-testid="settings-list">
          <button type="button" data-testid="tile-profile" onClick={() => setActiveTile("profile")} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#FDFBF7] transition text-left">
            <Settings size={16} className="text-[#0A1F5C] shrink-0" />
            <span className="flex-1 text-sm font-semibold text-[#0A1F5C]">Profile</span>
            <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
          </button>
          <button type="button" data-testid="tile-legal" onClick={() => setActiveTile("legal")} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#FDFBF7] transition text-left">
            <FileText size={16} className="text-[#0A1F5C] shrink-0" />
            <span className="flex-1 text-sm font-semibold text-[#0A1F5C]">Legal &amp; Policies</span>
            <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
          </button>
          <button onClick={logout} data-testid="logout-button" className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#E68910]/[0.04] transition text-left">
            <LogOut size={16} className="text-[#E68910] shrink-0" />
            <span className="flex-1 text-sm font-semibold text-[#E68910]">Sign out</span>
          </button>
        </section>

        {(activeTile === "profile" || activeTile === "legal") && (
          <section data-testid={`panel-${activeTile}`} className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm mt-4">
            {activeTile === "profile" && <ProfilePanel form={form} setForm={setForm} onSave={saveProfile} busy={busy} />}
            {activeTile === "legal" && <LegalPanel />}
          </section>
        )}

        <div className="pb-8" />
      </main>

      {addrModal && <AddressSheet address={addrModal} onCancel={() => setAddrModal(null)} onSave={saveAddress} />}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#94A3B8] mt-6 mb-2">{children}</h3>;
}

// Shape-matching skeleton for the initial fetch (same animate-pulse +
// bg-[#E5E2DC] idiom as CategoryClient's SkeletonGrid and the cart page's
// own hasHydrated skeleton) — mirrors the profile card, tile grid, and
// panel this page renders once real data lands, so there's no layout jump
// when the skeleton swaps for content.
function AccountSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-[#FDFBF7]" data-testid="account-loading">
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-8 pt-8">
        <section className="bg-white border border-[#E5E2DC] rounded-3xl p-4 sm:p-6 flex items-center gap-4 shadow-sm">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#E5E2DC] animate-pulse shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-32 bg-[#E5E2DC] rounded-lg animate-pulse" />
            <div className="h-3.5 w-24 bg-[#E5E2DC] rounded-lg animate-pulse" />
          </div>
        </section>

        <div className="h-2.5 w-20 bg-[#E5E2DC] rounded animate-pulse mt-6 mb-2" />
        <section className="grid grid-cols-3 gap-3 sm:gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white border border-[#E5E2DC] rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center gap-2">
              <div className="w-[22px] h-[22px] rounded-md bg-[#E5E2DC] animate-pulse" />
              <div className="h-2.5 w-10 bg-[#E5E2DC] rounded animate-pulse" />
            </div>
          ))}
        </section>

        <section className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm mt-4 space-y-1">
          <div className="h-5 w-32 bg-[#E5E2DC] rounded-lg animate-pulse mb-3" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <div className="w-14 h-14 rounded-xl bg-[#E5E2DC] animate-pulse shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-3.5 w-1/2 bg-[#E5E2DC] rounded animate-pulse" />
                <div className="h-3 w-1/3 bg-[#E5E2DC] rounded animate-pulse" />
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3 sm:mb-4">
      <div>
        <h2 className="text-lg sm:text-xl font-display font-medium text-[#0A1F5C]">{title}</h2>
        {subtitle && <p className="text-xs text-[#64748B] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, body, ctaTo, ctaLabel }: { title: string; body: string; ctaTo?: string; ctaLabel?: string }) {
  return (
    <div className="py-10 text-center">
      <div className="text-[#0A1F5C] font-display text-base font-medium">{title}</div>
      <p className="text-sm text-[#64748B] mt-1">{body}</p>
      {ctaTo && (
        <Link href={ctaTo} className="inline-block mt-4 text-sm font-semibold text-[#E68910] hover:underline">{ctaLabel} →</Link>
      )}
    </div>
  );
}

type OrderAgeFilter = "all" | "7d" | "30d" | "older";
const ORDER_AGE_FILTERS: Array<{ key: OrderAgeFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "older", label: "Older" },
];
const DAY_MS = 86_400_000;

function OrdersPanel({ orders }: { orders: Order[] }) {
  const [expanded, setExpanded] = useState(false);
  const [ageFilter, setAgeFilter] = useState<OrderAgeFilter>("all");
  const delivered = orders.filter((o) => (o.status || "").toLowerCase().includes("deliver"));

  // Reuses the single already-fetched (backend-capped-at-50) order list —
  // "View all" and the filter both operate on data already in memory, no
  // second network call.
  const now = Date.now();
  const filtered = orders.filter((o) => {
    if (ageFilter === "all") return true;
    const age = now - new Date(o.created_at).getTime();
    if (ageFilter === "7d") return age <= 7 * DAY_MS;
    if (ageFilter === "30d") return age > 7 * DAY_MS && age <= 30 * DAY_MS;
    return age > 30 * DAY_MS;
  });
  const visible = expanded ? filtered : orders.slice(0, 5);

  return (
    <>
      <PanelHeader title={`Orders (${orders.length})`} subtitle={delivered.length ? `${delivered.length} delivered` : "Track every order from start to finish"} />

      {expanded && orders.length > 5 && (
        <div className="flex gap-1.5 mb-3 -mt-1 overflow-x-auto" data-testid="orders-filter">
          {ORDER_AGE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAgeFilter(key)}
              data-testid={`orders-filter-${key}`}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                ageFilter === key ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#0A1F5C] border-[#E5E2DC]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {orders.length === 0 ? (
        <EmptyState title="No orders yet" body="Start shopping from your nearby Bhilai stores." ctaTo="/" ctaLabel="Start shopping" />
      ) : (
        <>
          {expanded && filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#64748B]">No orders in this range.</p>
          ) : (
            <div className="divide-y divide-[#E5E2DC]">
              {visible.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} data-testid={`order-${o.id}`}
                  className="flex items-center gap-3 py-3 first:pt-0 hover:bg-[#FDFBF7] -mx-3 px-3 rounded-xl transition">
                  {(o.items?.[0]?.image) ? (
                    <Image src={o.items[0].image} alt="" width={56} height={56} className="w-14 h-14 rounded-xl object-cover border border-[#E5E2DC] bg-[#FDFBF7]" />
                  ) : <div className="w-14 h-14 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC] grid place-items-center"><Package size={20} className="text-[#64748B]" /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#0A1F5C] truncate">{o.id}</div>
                    <div className="text-[11px] text-[#64748B] mt-0.5 truncate">{new Date(o.created_at).toLocaleDateString()} · {(o.items || []).length} item{(o.items || []).length === 1 ? "" : "s"}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 max-w-[104px]">
                    <span className="text-sm font-semibold text-[#0A1F5C] whitespace-nowrap">₹{Number(o.total).toLocaleString()}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-center leading-tight ${statusTone(o.status)}`}>
                      {(o.status || "").replace(/_/g, " ")}
                    </span>
                  </div>
                  <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
                </Link>
              ))}
            </div>
          )}

          {!expanded && orders.length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              data-testid="orders-view-all"
              className="w-full mt-3 py-2.5 text-center text-sm font-semibold text-[#0A1F5C] border border-[#E5E2DC] rounded-xl hover:border-[#0A1F5C] transition"
            >
              View all orders
            </button>
          )}
        </>
      )}
    </>
  );
}


function AddressesPanel({ addresses, onAdd, onRemove, phone }: { addresses: CustomerAddress[]; onAdd: () => void; onRemove: (id: string) => void; phone: string }) {
  return (
    <>
      <PanelHeader
        title={`Saved addresses (${addresses.length})`}
        subtitle="Tap an address at checkout — no retyping."
        action={
          <button onClick={onAdd} data-testid="add-address" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-semibold hover:bg-[#08174A] transition">
            <Plus size={13} /> Add new
          </button>
        }
      />
      {addresses.length === 0 ? (
        <EmptyState title="No addresses saved" body="Add an address for one-tap checkout." />
      ) : (
        <div className="grid gap-2">
          {addresses.map((a) => (
            <div key={a.id} data-testid={`addr-${a.id}`} className="border border-[#E5E2DC] rounded-2xl p-4 flex items-start justify-between gap-3 hover:border-[#0A1F5C] transition">
              <div className="flex-1 text-sm min-w-0">
                <div className="font-semibold text-[#0A1F5C] flex items-center gap-2">
                  <HomeIcon size={13} /> {a.label || "Home"}
                  {a.name && <span className="text-[#64748B] font-normal">· {a.name}</span>}
                </div>
                <div className="text-[#64748B] mt-0.5">{a.line1}</div>
                {a.landmark && <div className="text-[11px] text-[#64748B]">Landmark: {a.landmark}</div>}
                <div className="text-[11px] text-[#64748B]">{a.city || "Bhilai"} · {a.pincode} · {a.phone || phone}</div>
              </div>
              <button onClick={() => onRemove(a.id)} data-testid={`del-addr-${a.id}`} className="text-rose-500 hover:bg-rose-50 p-2 rounded-full shrink-0"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function CouponsPanel({ coupons, loading }: { coupons: ActiveCoupon[]; loading: boolean }) {
  return (
    <>
      <PanelHeader title="Coupons" subtitle="Apply these at checkout." />
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((n) => <div key={n} className="h-16 bg-[#FDFBF7] rounded-2xl animate-pulse" />)}
        </div>
      ) : coupons.length === 0 ? (
        <p className="py-10 text-center text-sm text-[#64748B]">No coupons available right now.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => <CouponRow key={c.id} coupon={c} />)}
        </div>
      )}
    </>
  );
}

function CouponRow({ coupon }: { coupon: ActiveCoupon }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy code");
    }
  };
  const amount = coupon.discount_type === "percent" ? `${coupon.discount_value}% off` : `₹${Number(coupon.discount_value).toLocaleString()} off`;
  const condition = coupon.min_order_value > 0 ? `On orders above ₹${Number(coupon.min_order_value).toLocaleString()}` : "No minimum order value";
  return (
    <div data-testid={`coupon-${coupon.code}`} className="border border-dashed border-[#E5E2DC] rounded-2xl p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-bold text-[#0A1F5C]">{amount}</div>
        <div className="text-[11px] text-[#64748B] mt-0.5">{condition}</div>
        {coupon.expires_at && (
          <div className="text-[10px] text-[#94A3B8] mt-0.5">
            Valid till {new Date(coupon.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        data-testid={`coupon-copy-${coupon.code}`}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-[#E68910] bg-white text-[#0A1F5C] text-xs font-bold tracking-wide"
      >
        {coupon.code}
        {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function ProfilePanel({ form, setForm, onSave, busy }: { form: { name: string; gender: string; dob: string; email: string }; setForm: (f: { name: string; gender: string; dob: string; email: string }) => void; onSave: () => void; busy: boolean }) {
  return (
    <>
      <PanelHeader title="Profile" subtitle="Keep these up to date for smooth checkouts." />
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name"><input data-testid="cust-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
        <Field label="Gender">
          <select data-testid="cust-gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white text-[#0A1F5C]">
            <option value="">Prefer not to say</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Non-binary">Non-binary</option>
          </select>
        </Field>
        <Field label="Date of birth"><input data-testid="cust-dob" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
        <Field label="Email (optional)"><input data-testid="cust-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
      </div>
      <div className="flex justify-end mt-4">
        <button onClick={onSave} disabled={busy} data-testid="save-profile" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50 hover:bg-[#D97706] transition">
          <Save size={14} /> {busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </>
  );
}

// G13 §14 — replaces the old always-rendered 7-row policy-link section
// (account-policy-links) with an on-demand panel reached via the Settings
// list's "Legal & Policies" row — same links, same destinations, just not
// occupying permanent vertical space on every page load. The Try & Buy
// explainer (previously its own standalone banner between the panel and
// the policy list) is folded in here too, rather than dropped.
function LegalPanel() {
  const links = [
    { href: "/try-and-buy", label: "How Try & Buy works", sub: "Try it on at your door, keep what you love", icon: RotateCcw },
    ...POLICY_LINKS,
  ];
  return (
    <>
      <PanelHeader title="Legal & Policies" />
      <div className="-mx-2">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              data-testid={`account-link-${l.href.replace(/\//g, "")}`}
              className="flex items-center gap-3 px-2 py-3 hover:bg-[#FDFBF7] rounded-xl transition"
            >
              <div className="w-9 h-9 rounded-full bg-[#0A1F5C]/8 flex items-center justify-center shrink-0">
                <Icon size={16} className="text-[#0A1F5C]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[#0A1F5C]">{l.label}</div>
                <div className="text-[11px] text-[#64748B]">{l.sub}</div>
              </div>
              <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#64748B] mb-1.5">{label}</div>
      {children}
    </label>
  );
}
