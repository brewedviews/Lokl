import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Phone, Save, Package, MapPin, Plus, Trash2, Home as HomeIcon,
  Heart, Wallet, TicketPercent, HelpCircle, Settings, RotateCcw, ChevronRight,
  LogOut, Pencil
} from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import api, { getCustomerToken, getCustomerPhone, clearCustomerSession } from "../lib/api";
import { toast } from "sonner";
import { getWishlist, removeFromWishlist } from "../lib/wishlist";
import CustomerOtpLogin from "../components/consumer/CustomerOtpLogin";

const BLANK_ADDR = { name: "", phone: "", label: "Home", line1: "", landmark: "", city: "Bhilai", pincode: "" };

const AVATAR_FALLBACK =
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?crop=entropy&cs=srgb&fm=jpg&w=200&q=80";

function statusTone(s) {
  const x = (s || "").toLowerCase();
  if (x.includes("deliver") && !x.includes("pending")) return "text-emerald-700 bg-emerald-50";
  if (x.includes("cancel") || x.includes("reject")) return "text-rose-700 bg-rose-50";
  if (x.includes("complet")) return "text-[#E68910] bg-[#E68910]/10";
  return "text-[#0A1F5C] bg-[#0A1F5C]/10";
}

// Profile header — name/edit/badge live in the SAME inline-flow, so the
// "LOKL MEMBER" pill can wrap cleanly onto the next line on narrow screens
// instead of overlapping the name + pencil button.
function ProfileHeaderCard({ name, phone, onEdit }) {
  return (
    <section
      data-testid="profile-header-card"
      className="bg-white border border-[#E5E2DC] rounded-3xl p-4 sm:p-6 flex items-center gap-4 shadow-sm"
    >
      <img src={AVATAR_FALLBACK} alt="" className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover border border-[#E5E2DC] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
          <h2 className="text-lg sm:text-2xl font-display font-bold text-[#0A1F5C] leading-tight">
            {name || "Welcome"}
          </h2>
          <button
            data-testid="edit-profile-inline"
            onClick={onEdit}
            className="text-[#64748B] hover:text-[#0A1F5C] transition"
            aria-label="Edit profile"
          >
            <Pencil size={14} />
          </button>
          <span className="bg-[#F59E0B]/10 text-[#F59E0B] px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
            Lokl Member
          </span>
        </div>
        <div className="text-sm text-[#64748B] mt-0.5">+{phone}</div>
      </div>
    </section>
  );
}

// Tile that visually highlights when active, just like Myntra/Ajio account tabs.
function QuickTile({ icon: Icon, label, count, active, onClick, testid, soon }) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={active}
      onClick={onClick}
      className={`relative bg-white rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center gap-2 transition-all
        ${active
          ? "border-2 border-[#0A1F5C] bg-[#0A1F5C]/[0.04] shadow-md"
          : "border border-[#E5E2DC] hover:border-[#0A1F5C] hover:shadow-md"}`}
    >
      <Icon size={22} strokeWidth={1.6} className={`${soon ? "text-[#94A3B8]" : "text-[#0A1F5C]"}`} />
      <span className={`text-[11px] sm:text-xs font-semibold text-center leading-tight ${soon ? "text-[#94A3B8]" : "text-[#0A1F5C]"}`}>{label}</span>
      {soon ? (
        <span className="absolute -top-1.5 -right-1.5 bg-slate-400 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm ring-2 ring-white uppercase tracking-wider">
          Soon
        </span>
      ) : count > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 bg-[#E68910] text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center rounded-full shadow-sm ring-2 ring-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}

export default function CustomerAccount() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const validTiles = ["orders", "returns", "addresses", "wishlist", "wallet", "coupons", "support", "profile"];
  const [phone, setPhone] = useState(getCustomerPhone());
  const [hasAuth, setHasAuth] = useState(!!getCustomerToken());
  const [data, setData] = useState(null);
  const [returns, setReturns] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [form, setForm] = useState({ name: "", age: "", email: "" });
  const [addrModal, setAddrModal] = useState(null);
  const [activeTile, setActiveTile] = useState(validTiles.includes(tabParam) ? tabParam : "orders");
  const [busy, setBusy] = useState(false);

  // Honour deep-link tab changes (e.g. sticky-nav clicks while already on /account)
  useEffect(() => {
    if (tabParam && validTiles.includes(tabParam)) setActiveTile(tabParam);
    // eslint-disable-next-line
  }, [tabParam]);

  const refreshWishlist = () => setWishlist(getWishlist(phone));

  const load = async () => {
    if (!phone) return;
    try {
      const { data } = await api.get(`/customer/${phone}`);
      setData(data);
      const c = data.customer || {};
      setForm({ name: c.name || "", age: c.age || "", email: c.email || "" });
    } catch { setData({ customer: { phone, addresses: [] }, orders: [] }); }
    try {
      const { data: r } = await api.get(`/customer/${phone}/returns`);
      setReturns(Array.isArray(r) ? r : (r?.returns || []));
    } catch { setReturns([]); }
    refreshWishlist();
  };

  useEffect(() => { if (hasAuth && phone) load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    // React to login / logout from anywhere in the app.
    const onAuthChange = () => {
      const t = getCustomerToken();
      const p = getCustomerPhone();
      setPhone(p);
      setHasAuth(!!t);
      if (t && p) load();
      else { setData(null); setReturns([]); setWishlist([]); }
    };
    window.addEventListener("customer-auth:change", onAuthChange);
    return () => window.removeEventListener("customer-auth:change", onAuthChange);
    // eslint-disable-next-line
  }, []);
  useEffect(() => {
    const onChange = () => refreshWishlist();
    window.addEventListener("wishlist:change", onChange);
    return () => window.removeEventListener("wishlist:change", onChange);
    // eslint-disable-next-line
  }, [phone]);

  const onLoginSuccess = (p) => { setPhone(p); setHasAuth(true); };

  const saveProfile = async () => {
    if (!phone) return;
    setBusy(true);
    try {
      await api.post("/customer/upsert", {
        phone, name: form.name, age: form.age ? Number(form.age) : null, email: form.email,
      });
      toast.success("Profile saved"); load();
    } catch { toast.error("Failed to save"); }
    finally { setBusy(false); }
  };

  const saveAddress = async (addr) => {
    if (!addr.line1.trim() || !addr.pincode.trim()) return toast.error("Address line & pincode are required");
    const cityNorm = (addr.city || "").trim().toLowerCase();
    if (cityNorm && cityNorm !== "bhilai") return toast.error("Lokl currently serves Bhilai only");
    try {
      await api.post(`/customer/${phone}/addresses`, addr);
      toast.success("Address saved"); setAddrModal(null); load();
    } catch { toast.error("Failed to save address"); }
  };

  const removeAddress = async (aid) => {
    if (!window.confirm("Remove this address?")) return;
    await api.delete(`/customer/${phone}/addresses/${aid}`);
    load();
  };

  const logout = async () => {
    if (!window.confirm("Sign out of this device?")) return;
    try { await api.post("/auth/logout"); } catch { /* best-effort */ }
    clearCustomerSession();
    setPhone(""); setHasAuth(false); setData(null); setReturns([]); setWishlist([]);
    toast.success("Signed out");
  };

  const addresses = data?.customer?.addresses || [];
  const orders = data?.orders || [];

  // ----- OTP login gate -----
  if (!hasAuth) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <ConsumerHeader />
        <div className="flex-1 max-w-md w-full mx-auto px-4 sm:px-8 pt-10 pb-16">
          <CustomerOtpLogin
            title="Sign in"
            subtitle="Enter your number to view orders, addresses, and returns."
            onSuccess={onLoginSuccess}
          />
        </div>
        <Footer />
      </div>
    );
  }

  const tiles = [
    { key: "orders",    label: "Orders",    icon: Package,        count: orders.length },
    { key: "returns",   label: "Returns",   icon: RotateCcw,      count: returns.length },
    { key: "addresses", label: "Addresses", icon: MapPin,         count: addresses.length },
    { key: "wishlist",  label: "Wishlist",  icon: Heart,          count: wishlist.length },
    { key: "wallet",    label: "Wallet",    icon: Wallet,         count: 0, soon: true },
    { key: "coupons",   label: "Coupons",   icon: TicketPercent,  count: 0, soon: true },
    { key: "support",   label: "Support",   icon: HelpCircle,     count: 0 },
    { key: "profile",   label: "Profile",   icon: Settings,       count: 0 },
  ];

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <ConsumerHeader />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-8 pt-8">
        <ProfileHeaderCard name={form.name} phone={phone} onEdit={() => setActiveTile("profile")} />

        {/* Quick action tile grid — selected tile is visually highlighted */}
        <section data-testid="quick-actions" className="grid grid-cols-4 gap-3 sm:gap-4 pt-8">
          {tiles.map((t) => (
            <QuickTile
              key={t.key}
              icon={t.icon}
              label={t.label}
              count={t.count}
              soon={t.soon}
              active={!t.soon && activeTile === t.key}
              onClick={() => {
                if (t.soon) {
                  toast.message(`${t.label} — coming soon`);
                  return;
                }
                if (t.key === "wishlist") {
                  // Wishlist now has its own dedicated route — keep behaviour
                  // consistent with the bottom-nav so users never end up on the
                  // old in-tile view.
                  window.location.href = "/wishlist";
                  return;
                }
                setActiveTile(t.key);
              }}
              testid={`tile-${t.key}`}
            />
          ))}
        </section>

        {/* Single content panel driven by the selected tile (Myntra/Ajio pattern) */}
        <section data-testid={`panel-${activeTile}`} className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm mt-8">
          {activeTile === "orders" && (
            <OrdersPanel orders={orders} />
          )}
          {activeTile === "returns" && (
            <ReturnsPanel returns={returns} />
          )}
          {activeTile === "addresses" && (
            <AddressesPanel
              addresses={addresses}
              onAdd={() => setAddrModal({ ...BLANK_ADDR, name: form.name, phone })}
              onRemove={removeAddress}
              phone={phone}
            />
          )}
          {activeTile === "wishlist" && (
            <WishlistPanel items={wishlist} onRemove={(id) => { removeFromWishlist(id, phone); refreshWishlist(); }} />
          )}
          {activeTile === "wallet" && (
            <ComingSoon
              title="Lokl Wallet"
              copy="Earn cashback on every Lokl order. Use credits at checkout. Launching soon."
              cta="Browse stores"
              to="/stores"
            />
          )}
          {activeTile === "coupons" && (
            <ComingSoon
              title="Coupons & offers"
              copy="Personal coupons from your favourite Bhilai stores will land here."
              cta="See offers"
              to="/"
            />
          )}
          {activeTile === "support" && (
            <SupportPanel />
          )}
          {activeTile === "profile" && (
            <ProfilePanel form={form} setForm={setForm} onSave={saveProfile} busy={busy} />
          )}
        </section>

        {/* Outlined sign-out card — matches the surrounding card aesthetic */}
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
      <Footer />
    </div>
  );
}

// ---------- Panels ----------

function PanelHeader({ title, subtitle, action }) {
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

function EmptyState({ title, body, ctaTo, ctaLabel }) {
  return (
    <div className="py-10 text-center">
      <div className="text-[#0A1F5C] font-display text-base font-bold">{title}</div>
      <p className="text-sm text-[#64748B] mt-1">{body}</p>
      {ctaTo && (
        <Link to={ctaTo} className="inline-block mt-4 text-sm font-semibold text-[#E68910] hover:underline">
          {ctaLabel} →
        </Link>
      )}
    </div>
  );
}

function OrdersPanel({ orders }) {
  const delivered = orders.filter((o) => (o.status || "").toLowerCase().includes("deliver"));
  return (
    <>
      <PanelHeader title={`Orders (${orders.length})`} subtitle={delivered.length ? `${delivered.length} delivered` : "Track every order from start to finish"} />
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" body="Start shopping from your nearby Bhilai stores." ctaTo="/" ctaLabel="Start shopping" />
      ) : (
        <div className="divide-y divide-[#E5E2DC]">
          {orders.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} data-testid={`order-${o.id}`}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-[#FDFBF7] -mx-3 px-3 rounded-xl transition">
              {(o.items || [])[0]?.image
                ? <img src={o.items[0].image} alt="" className="w-14 h-14 rounded-xl object-cover border border-[#E5E2DC] bg-[#FDFBF7]" />
                : <div className="w-14 h-14 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC] grid place-items-center"><Package size={20} className="text-[#64748B]" /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#0A1F5C] truncate">{o.id}</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">{new Date(o.created_at).toLocaleDateString()} · {(o.items || []).length} item{(o.items || []).length === 1 ? "" : "s"}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-sm font-semibold text-[#0A1F5C]">₹{Number(o.total).toLocaleString()}</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusTone(o.return_status || o.status)}`}>
                  {(o.return_status || o.status || "").replace(/_/g, " ")}
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

function ReturnsPanel({ returns }) {
  return (
    <>
      <PanelHeader title={`Returns (${returns.length})`} subtitle="Returns and pickup tracking" />
      {returns.length === 0 ? (
        <EmptyState title="No returns yet" body="You can request a return within 24 hours of delivery on eligible items." ctaTo="/" ctaLabel="Browse stores" />
      ) : (
        <div className="divide-y divide-[#E5E2DC]">
          {returns.map((r) => (
            <Link key={r.id} to={`/returns/${r.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-[#FDFBF7] -mx-3 px-3 rounded-xl transition" data-testid={`return-${r.id}`}>
              <div className="w-12 h-12 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC] grid place-items-center shrink-0"><RotateCcw size={18} className="text-[#0A1F5C]" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#0A1F5C] truncate">{r.order_id || r.id}</div>
                <div className="text-[11px] text-[#64748B]">{r.reason || "Return"}{r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString()}` : ""}</div>
              </div>
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${statusTone(r.status)}`}>
                {(r.status || "").replace(/_/g, " ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function AddressesPanel({ addresses, onAdd, onRemove, phone }) {
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

function WishlistPanel({ items, onRemove }) {
  return (
    <>
      <PanelHeader title={`Wishlist (${items.length})`} subtitle="Tap the heart on any product to save it." />
      {items.length === 0 ? (
        <EmptyState title="Your wishlist is empty" body="Tap the ♡ on any product to save it for later." ctaTo="/" ctaLabel="Discover products" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {items.map((p) => (
            <div key={p.id} className="relative bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden hover:shadow-md transition" data-testid={`wish-${p.id}`}>
              <Link to={`/product/${p.id}`} className="block">
                {p.image ? (
                  <img src={p.image} alt={p.name} className="w-full aspect-[4/5] object-cover" />
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
              <button
                onClick={() => onRemove(p.id)}
                data-testid={`wish-remove-${p.id}`}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 text-rose-500 hover:bg-rose-50 grid place-items-center shadow-sm border border-[#E5E2DC]"
                aria-label="Remove from wishlist"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ProfilePanel({ form, setForm, onSave, busy }) {
  return (
    <>
      <PanelHeader title="Profile" subtitle="Keep these up to date for smooth checkouts." />
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name"><input data-testid="cust-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
        <Field label="Age"><input data-testid="cust-age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
        <Field label="Email (optional)" full><input data-testid="cust-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
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
        <a href="mailto:hello@lokl.in" className="border border-[#E5E2DC] rounded-2xl p-4 hover:border-[#0A1F5C] transition" data-testid="support-email">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Email</div>
          <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5">hello@lokl.in</div>
        </a>
        <a href="tel:+917000070000" className="border border-[#E5E2DC] rounded-2xl p-4 hover:border-[#0A1F5C] transition" data-testid="support-phone">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Phone</div>
          <div className="text-sm font-semibold text-[#0A1F5C] mt-0.5">+91 70000 70000</div>
        </a>
      </div>
    </>
  );
}

function ComingSoon({ title, copy, cta, to }) {
  return (
    <>
      <PanelHeader title={title} subtitle="Coming soon" />
      <EmptyState title={title} body={copy} ctaTo={to} ctaLabel={cta} />
    </>
  );
}

function AddressModal({ address, onCancel, onSave }) {
  const [a, setA] = useState(address);
  const set = (k, v) => setA((p) => ({ ...p, [k]: v }));
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
        </div>
        <div className="flex gap-2 pt-5">
          <button onClick={onCancel} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC] text-[#0A1F5C]">Cancel</button>
          <button onClick={() => onSave(a)} data-testid="save-address" className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold hover:bg-[#D97706] transition">Save address</button>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children, full }) => (
  <label className={`block ${full ? "sm:col-span-2" : ""}`}>
    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#64748B] mb-1.5">{label}</div>
    {children}
  </label>
);
