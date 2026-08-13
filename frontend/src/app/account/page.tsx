"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  Save, Package, MapPin, Plus, Trash2, Home as HomeIcon, Heart, Wallet,
  TicketPercent, HelpCircle, Settings, ChevronRight, LogOut, Pencil, RotateCcw,
  Phone, Info, FileText, Shield, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/api-error";
import { useCustomerAuthStore, useWishlistStore } from "@/stores";
import { AddressPinPicker } from "@/components/consumer/AddressPinPicker";
import type {
  Customer, CustomerAddress, Order, ProductCard,
} from "@/types";

// Group C2 — lat/lng typed explicitly (not inferred from a `null` literal)
// so AddressModal's onChange can assign real numbers to them.
type AddressForm = {
  name: string; phone: string; label: string; line1: string; landmark: string;
  city: string; pincode: string; lat: number | null; lng: number | null;
};
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

type TileKey = "orders" | "addresses" | "wishlist" | "wallet" | "coupons" | "support" | "profile";
const VALID_TILES: TileKey[] = ["orders", "addresses", "wishlist", "wallet", "coupons", "support", "profile"];

// Legal/support pages — previously only linked from the dead, unimported
// Footer.tsx (Terms/Privacy) or not linked anywhere at all (the other 5).
// This list is their first reachable entry point in the app.
const POLICY_LINKS: { href: string; label: string; sub: string; icon: typeof Phone }[] = [
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
  const wishlist = useWishlistStore((s) => s.products);
  const removeFromWishlist = useWishlistStore((s) => s.toggle);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
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

  const tiles: Array<{ key: TileKey; label: string; icon: typeof Package; count: number; soon?: boolean }> = [
    { key: "orders", label: "Orders", icon: Package, count: orders.length },
    { key: "addresses", label: "Addresses", icon: MapPin, count: addresses.length },
    { key: "wishlist", label: "Wishlist", icon: Heart, count: wishlist.length },
    { key: "wallet", label: "Wallet", icon: Wallet, count: 0, soon: true },
    { key: "coupons", label: "Coupons", icon: TicketPercent, count: 0, soon: true },
    { key: "support", label: "Support", icon: HelpCircle, count: 0 },
    { key: "profile", label: "Profile", icon: Settings, count: 0 },
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
              <h2 className="text-lg sm:text-2xl font-display font-bold text-[#0A1F5C] leading-tight">{form.name || "Welcome"}</h2>
              <button data-testid="edit-profile-inline" onClick={() => setActiveTile("profile")} className="text-[#64748B] hover:text-[#0A1F5C] transition" aria-label="Edit profile">
                <Pencil size={14} />
              </button>
              <span className="bg-[#F59E0B]/10 text-[#F59E0B] px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Lokl Member</span>
            </div>
            <div className="text-sm text-[#64748B] mt-0.5">+{phone}</div>
          </div>
        </section>

        <section data-testid="quick-actions" className="grid grid-cols-4 gap-3 sm:gap-4 pt-8">
          {tiles.map((t) => {
            const Icon = t.icon;
            const active = !t.soon && activeTile === t.key;
            return (
              <button
                key={t.key}
                type="button"
                data-testid={`tile-${t.key}`}
                aria-pressed={active}
                onClick={() => {
                  if (t.soon) { toast.message(`${t.label} — coming soon`); return; }
                  if (t.key === "support") { window.location.href = "/account/support"; return; }
                  setActiveTile(t.key);
                }}
                className={`relative bg-white rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center gap-2 transition-all
                  ${active ? "border-2 border-[#0A1F5C] bg-[#0A1F5C]/[0.04] shadow-md" : "border border-[#E5E2DC] hover:border-[#0A1F5C] hover:shadow-md"}`}
              >
                <Icon size={22} strokeWidth={1.6} className={`${t.soon ? "text-[#94A3B8]" : "text-[#0A1F5C]"}`} />
                <span className={`text-[11px] sm:text-xs font-semibold text-center leading-tight ${t.soon ? "text-[#94A3B8]" : "text-[#0A1F5C]"}`}>{t.label}</span>
                {t.soon ? (
                  <span className="absolute -top-1.5 -right-1.5 bg-slate-400 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm ring-2 ring-white uppercase tracking-wider">Soon</span>
                ) : t.count > 0 ? (
                  <span className="absolute -top-1.5 -right-1.5 bg-[#E68910] text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center rounded-full shadow-sm ring-2 ring-white">{t.count > 99 ? "99+" : t.count}</span>
                ) : null}
              </button>
            );
          })}
        </section>

        <section data-testid={`panel-${activeTile}`} className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm mt-8">
          {activeTile === "orders" && <OrdersPanel orders={orders} />}
          {activeTile === "addresses" && (
            <AddressesPanel
              addresses={addresses}
              onAdd={() => setAddrModal({ ...BLANK_ADDR, name: form.name, phone: phone.slice(-10) })}
              onRemove={removeAddress}
              phone={phone}
            />
          )}
          {activeTile === "wishlist" && <WishlistPanel items={wishlist} onRemove={(id) => { const p = wishlist.find((x) => x.id === id); if (p) removeFromWishlist(p); }} />}
          {activeTile === "wallet" && <ComingSoon title="Lokl Wallet" copy="Earn cashback on every Lokl order. Use credits at checkout. Launching soon." cta="Browse stores" to="/stores" />}
          {activeTile === "coupons" && <ComingSoon title="Coupons & offers" copy="Personal coupons from your favourite Bhilai stores will land here." cta="See offers" to="/" />}
          {activeTile === "support" && <SupportPanel />}
          {activeTile === "profile" && <ProfilePanel form={form} setForm={setForm} onSave={saveProfile} busy={busy} />}
        </section>

        <Link
          href="/try-and-buy"
          data-testid="how-try-and-buy-works"
          className="mt-4 w-full flex items-center gap-3 bg-white border border-[#E5E2DC] hover:border-[#0A1F5C] rounded-2xl px-4 py-3.5 transition"
        >
          <div className="w-9 h-9 rounded-full bg-[#E68910]/10 flex items-center justify-center shrink-0">
            <RotateCcw size={16} className="text-[#E68910]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-[#0A1F5C]">How Try &amp; Buy works</div>
            <div className="text-[11px] text-[#64748B]">Try it on at your door, keep what you love</div>
          </div>
          <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
        </Link>

        <section className="mt-4 bg-white border border-[#E5E2DC] rounded-3xl p-2 sm:p-3" data-testid="account-policy-links">
          {POLICY_LINKS.map((l) => {
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                data-testid={`account-link-${l.href.replace(/\//g, "")}`}
                className="flex items-center gap-3 px-3 py-3 hover:bg-[#FDFBF7] rounded-xl transition"
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
        </section>

        <button
          onClick={logout}
          data-testid="logout-button"
          className="mt-8 w-full flex items-center justify-center gap-2 bg-white border border-[#E5E2DC] hover:border-[#E68910] hover:bg-[#E68910]/[0.04] text-[#E68910] rounded-2xl py-3.5 sm:py-4 font-semibold text-sm transition shadow-sm"
        >
          <LogOut size={15} /> Sign out
        </button>
        <div className="pb-8" />
      </main>

      {addrModal && <AddressModal address={addrModal} onCancel={() => setAddrModal(null)} onSave={saveAddress} />}
    </div>
  );
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

        <section className="grid grid-cols-4 gap-3 sm:gap-4 pt-8">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="bg-white border border-[#E5E2DC] rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center gap-2">
              <div className="w-[22px] h-[22px] rounded-md bg-[#E5E2DC] animate-pulse" />
              <div className="h-2.5 w-10 bg-[#E5E2DC] rounded animate-pulse" />
            </div>
          ))}
        </section>

        <section className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm mt-8 space-y-1">
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
        <h2 className="text-lg sm:text-xl font-display font-bold text-[#0A1F5C]">{title}</h2>
        {subtitle && <p className="text-xs text-[#64748B] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ title, body, ctaTo, ctaLabel }: { title: string; body: string; ctaTo?: string; ctaLabel?: string }) {
  return (
    <div className="py-10 text-center">
      <div className="text-[#0A1F5C] font-display text-base font-bold">{title}</div>
      <p className="text-sm text-[#64748B] mt-1">{body}</p>
      {ctaTo && (
        <Link href={ctaTo} className="inline-block mt-4 text-sm font-semibold text-[#E68910] hover:underline">{ctaLabel} →</Link>
      )}
    </div>
  );
}

function OrdersPanel({ orders }: { orders: Order[] }) {
  const delivered = orders.filter((o) => (o.status || "").toLowerCase().includes("deliver"));
  return (
    <>
      <PanelHeader title={`Orders (${orders.length})`} subtitle={delivered.length ? `${delivered.length} delivered` : "Track every order from start to finish"} />
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" body="Start shopping from your nearby Bhilai stores." ctaTo="/" ctaLabel="Start shopping" />
      ) : (
        <div className="divide-y divide-[#E5E2DC]">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} data-testid={`order-${o.id}`}
              className="flex items-center gap-3 py-3 first:pt-0 hover:bg-[#FDFBF7] -mx-3 px-3 rounded-xl transition">
              {(o.items?.[0]?.image) ? (
                <Image src={o.items[0].image} alt="" width={56} height={56} className="w-14 h-14 rounded-xl object-cover border border-[#E5E2DC] bg-[#FDFBF7]" />
              ) : <div className="w-14 h-14 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC] grid place-items-center"><Package size={20} className="text-[#64748B]" /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#0A1F5C] truncate">{o.id}</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">{new Date(o.created_at).toLocaleDateString()} · {(o.items || []).length} item{(o.items || []).length === 1 ? "" : "s"}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-sm font-semibold text-[#0A1F5C]">₹{Number(o.total).toLocaleString()}</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusTone(o.status)}`}>
                  {(o.status || "").replace(/_/g, " ")}
                </span>
              </div>
              <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
            </Link>
          ))}
        </div>
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

function WishlistPanel({ items, onRemove }: { items: ProductCard[]; onRemove: (id: string) => void }) {
  return (
    <>
      <PanelHeader title={`Wishlist (${items.length})`} subtitle="Tap the heart on any product to save it." />
      {items.length === 0 ? (
        <EmptyState title="Your wishlist is empty" body="Tap the ♡ on any product to save it for later." ctaTo="/" ctaLabel="Discover products" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {items.map((p) => (
            <div key={p.id} className="relative bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden hover:shadow-md transition" data-testid={`wish-${p.id}`}>
              <Link href={`/product/${p.id}`} className="block">
                {p.image ? (
                  <div className="relative w-full aspect-[4/5] bg-slate-100"><Image src={p.image} alt={p.name} fill sizes="(max-width: 640px) 50vw, 240px" className="object-cover" /></div>
                ) : (
                  <div className="w-full aspect-[4/5] bg-[#FDFBF7] grid place-items-center"><Package size={28} className="text-[#94A3B8]" /></div>
                )}
                <div className="p-2.5">
                  {p.store_name && <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] line-clamp-1">{p.store_name}</div>}
                  <div className="text-[12px] font-semibold text-[#0A1F5C] line-clamp-1 mt-0.5">{p.name}</div>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-sm font-bold text-[#0A1F5C]">₹{Number(p.price || 0).toLocaleString()}</span>
                    {p.mrp && p.mrp > p.price && <span className="text-[11px] text-[#94A3B8] line-through">₹{Number(p.mrp).toLocaleString()}</span>}
                  </div>
                </div>
              </Link>
              <button onClick={() => onRemove(p.id)} data-testid={`wish-remove-${p.id}`}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 text-rose-500 hover:bg-rose-50 grid place-items-center shadow-sm border border-[#E5E2DC]" aria-label="Remove from wishlist">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
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

function SupportPanel() {
  return (
    <>
      <PanelHeader title="Support" subtitle="We typically respond within an hour during store hours." />
      <div className="grid sm:grid-cols-2 gap-3">
        <a href="mailto:hello@shoplokl.in" className="border border-[#E5E2DC] rounded-2xl p-4 hover:border-[#0A1F5C] transition" data-testid="support-email">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Email</div>
          <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5">hello@shoplokl.in</div>
        </a>
        <a href="tel:+917719052107" className="border border-[#E5E2DC] rounded-2xl p-4 hover:border-[#0A1F5C] transition" data-testid="support-phone">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Phone</div>
          <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5">+91 77190 52107</div>
        </a>
      </div>
    </>
  );
}

function ComingSoon({ title, copy, cta, to }: { title: string; copy: string; cta: string; to: string }) {
  return <><PanelHeader title={title} subtitle="Coming soon" /><EmptyState title={title} body={copy} ctaTo={to} ctaLabel={cta} /></>;
}

function AddressModal({ address, onCancel, onSave }: { address: AddressForm; onCancel: () => void; onSave: (a: AddressForm) => void }) {
  const [a, setA] = useState(address);
  const set = (k: keyof Omit<AddressForm, "lat" | "lng">, v: string) => setA((p) => ({ ...p, [k]: v }));
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" data-testid="address-modal">
        <h3 className="text-xl font-display font-bold text-[#0A1F5C] mb-4">Add address</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label">
              <select data-testid="addr-label" value={a.label} onChange={(e) => set("label", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white text-[#0A1F5C]">
                <option>Home</option><option>Office</option><option>Other</option>
              </select>
            </Field>
            <Field label="Name"><input data-testid="addr-name" value={a.name} onChange={(e) => set("name", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
          </div>
          <Field label="Address line"><textarea data-testid="addr-line1" value={a.line1} onChange={(e) => set("line1", e.target.value)} rows={2} placeholder="House no, street, area" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
          <Field label="Landmark (optional)"><input data-testid="addr-landmark" value={a.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="e.g. Opposite SBI" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City"><input data-testid="addr-city" value={a.city} onChange={(e) => set("city", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
            <Field label="Pincode"><input data-testid="addr-pin" value={a.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
          </div>
          <Field label="Phone"><input data-testid="addr-phone" value={a.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
          <AddressPinPicker lat={a.lat} lng={a.lng} pincode={a.pincode} onChange={(lat, lng) => setA((p) => ({ ...p, lat, lng }))} />
        </div>
        <div className="flex gap-2 pt-5">
          <button onClick={onCancel} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC] text-[#0A1F5C]">Cancel</button>
          <button onClick={() => onSave(a)} data-testid="save-address" className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#D97706] transition">Save address</button>
        </div>
      </div>
    </div>
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
