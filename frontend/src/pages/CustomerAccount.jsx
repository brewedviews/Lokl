import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  User, Phone, Save, Package, MapPin, Plus, Trash2, Home as HomeIcon,
  Heart, Wallet, TicketPercent, HelpCircle, Settings, RotateCcw, ChevronRight,
  LogOut, Pencil
} from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import api from "../lib/api";
import { toast } from "sonner";

const BLANK_ADDR = { name: "", phone: "", label: "Home", line1: "", landmark: "", city: "Bhilai", pincode: "" };

const AVATAR_FALLBACK =
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?crop=entropy&cs=srgb&fm=jpg&w=200&q=80";

function statusTone(s) {
  const x = (s || "").toLowerCase();
  if (x.includes("deliver") && !x.includes("pending")) return "text-emerald-700 bg-emerald-50";
  if (x.includes("cancel") || x.includes("reject")) return "text-rose-700 bg-rose-50";
  return "text-[#E68910] bg-[#E68910]/10";
}

function ProfileHeaderCard({ name, phone, onEdit }) {
  return (
    <section
      data-testid="profile-header-card"
      className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 flex items-center gap-4 relative shadow-sm"
    >
      <img src={AVATAR_FALLBACK} alt="" className="w-16 h-16 rounded-full object-cover border border-[#E5E2DC]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl sm:text-2xl font-display font-bold text-[#0A1F5C] truncate">
            {name || "Welcome"}
          </h2>
          <button
            data-testid="edit-profile-inline"
            onClick={onEdit}
            className="text-[#64748B] hover:text-[#0A1F5C] transition shrink-0"
            aria-label="Edit profile"
          >
            <Pencil size={14} />
          </button>
        </div>
        <div className="text-sm text-[#64748B] mt-0.5">+91 {phone}</div>
      </div>
      <div className="absolute right-4 sm:right-6 top-5 sm:top-6">
        <span className="bg-[#F59E0B]/10 text-[#F59E0B] px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
          Lokl Member
        </span>
      </div>
    </section>
  );
}

function QuickTile({ icon: Icon, label, count, onClick, testid, soon }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className="bg-white border border-[#E5E2DC] rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center gap-2 hover:border-[#0A1F5C] hover:shadow-md transition-all relative"
    >
      <Icon size={22} strokeWidth={1.6} className="text-[#0A1F5C]" />
      <span className="text-[11px] sm:text-xs font-semibold text-[#0A1F5C] text-center leading-tight">{label}</span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 bg-[#E68910] text-white text-[10px] font-bold px-1.5 py-0.5 min-w-[18px] text-center rounded-full shadow-sm ring-2 ring-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
      {soon && (
        <span className="absolute -top-1.5 -right-1.5 bg-[#64748B] text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm ring-2 ring-white uppercase tracking-wider">
          Soon
        </span>
      )}
    </button>
  );
}

export default function CustomerAccount() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState(localStorage.getItem("bf_customer_phone") || "");
  const [hasPhone, setHasPhone] = useState(!!localStorage.getItem("bf_customer_phone"));
  const [data, setData] = useState(null);
  const [returns, setReturns] = useState([]);
  const [form, setForm] = useState({ name: "", age: "", email: "" });
  const [addrModal, setAddrModal] = useState(null);
  const [openSection, setOpenSection] = useState(null); // 'orders'|'addresses'|'profile'|null
  const [busy, setBusy] = useState(false);

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
  };

  useEffect(() => { if (phone) load(); /* eslint-disable-next-line */ }, []);

  const enterPhone = (e) => {
    e.preventDefault();
    if (!/^[0-9]{10}$/.test(phone)) return toast.error("Enter a valid 10-digit number");
    localStorage.setItem("bf_customer_phone", phone);
    setHasPhone(true);
    load();
  };

  const saveProfile = async () => {
    if (!phone) return;
    setBusy(true);
    try {
      await api.post("/customer/upsert", {
        phone, name: form.name, age: form.age ? Number(form.age) : null, email: form.email,
      });
      toast.success("Profile saved"); load(); setOpenSection(null);
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

  const logout = () => {
    if (!window.confirm("Sign out of this device?")) return;
    localStorage.removeItem("bf_customer_phone");
    setPhone(""); setHasPhone(false); setData(null); setReturns([]);
    toast.success("Signed out");
  };

  const addresses = data?.customer?.addresses || [];
  const orders = data?.orders || [];
  const recentOrders = orders.slice(0, 3);

  // Phone gate
  if (!hasPhone) {
    return (
      <div className="min-h-screen bg-[#FDFBF7]">
        <ConsumerHeader />
        <div className="max-w-md mx-auto px-4 sm:px-8 pt-10">
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#0A1F5C] tracking-tight">My account</h1>
          <p className="text-sm text-[#64748B] mt-1">Enter your number for one-tap checkout and order tracking.</p>
          <form onSubmit={enterPhone} className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6 shadow-sm">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#64748B] mb-2">Mobile number</div>
            <div className="flex items-center gap-3">
              <Phone size={16} className="text-[#E68910]" />
              <input
                data-testid="phone-lookup"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="10-digit mobile"
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]"
              />
              <button
                type="submit"
                data-testid="continue-account"
                className="px-5 py-2.5 rounded-full bg-[#0A1F5C] text-white text-sm font-semibold hover:bg-[#08174A] transition"
              >Continue</button>
            </div>
          </form>
        </div>
        <Footer />
      </div>
    );
  }

  const tiles = [
    { key: "orders",    label: "Orders",    icon: Package,        count: orders.length,           onClick: () => setOpenSection("orders") },
    { key: "returns",   label: "Returns",   icon: RotateCcw,      count: returns.length,          onClick: () => navigate("/orders") },
    { key: "addresses", label: "Addresses", icon: MapPin,         count: addresses.length,        onClick: () => setOpenSection("addresses") },
    { key: "wishlist",  label: "Wishlist",  icon: Heart,          soon: true,                     onClick: () => toast.message("Wishlist is coming soon") },
    { key: "wallet",    label: "Wallet",    icon: Wallet,         soon: true,                     onClick: () => toast.message("Lokl Wallet is coming soon") },
    { key: "coupons",   label: "Coupons",   icon: TicketPercent,  soon: true,                     onClick: () => toast.message("Coupons are coming soon") },
    { key: "support",   label: "Support",   icon: HelpCircle,                                     onClick: () => window.location.href = "mailto:hello@lokl.in" },
    { key: "settings",  label: "Profile",   icon: Settings,                                       onClick: () => setOpenSection("profile") },
  ];

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />

      <main className="max-w-3xl mx-auto px-4 sm:px-8 pt-8">
        <ProfileHeaderCard name={form.name} phone={phone} onEdit={() => setOpenSection("profile")} />

        {/* Quick action tile grid */}
        <section data-testid="quick-actions" className="grid grid-cols-4 gap-3 sm:gap-4 pt-8">
          {tiles.map((t) => (
            <QuickTile
              key={t.key}
              icon={t.icon}
              label={t.label}
              count={t.count}
              soon={t.soon}
              onClick={t.onClick}
              testid={`tile-${t.key}`}
            />
          ))}
        </section>

        {/* Recent orders preview — always shown unless section is open */}
        {openSection !== "orders" && (
          <section data-testid="recent-orders-list" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 shadow-sm mt-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-display font-bold text-[#0A1F5C]">Recent orders</h2>
              {orders.length > 3 && (
                <button onClick={() => setOpenSection("orders")} className="text-xs text-[#E68910] font-semibold hover:underline" data-testid="see-all-orders">
                  See all ({orders.length})
                </button>
              )}
            </div>
            {recentOrders.length === 0 ? (
              <div className="text-sm text-[#64748B] py-6 text-center">
                No orders yet. <Link to="/" className="text-[#E68910] font-semibold hover:underline">Start shopping →</Link>
              </div>
            ) : (
              <div className="divide-y divide-[#E5E2DC]">
                {recentOrders.map((o) => (
                  <Link key={o.id} to={`/orders/${o.id}`} data-testid={`recent-order-${o.id}`}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-[#FDFBF7] -mx-3 px-3 rounded-xl transition">
                    {(o.items || [])[0]?.image ? (
                      <img src={o.items[0].image} alt="" className="w-14 h-14 rounded-xl object-cover border border-[#E5E2DC] bg-[#FDFBF7]" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC] grid place-items-center"><Package size={20} className="text-[#64748B]" /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[#0A1F5C] truncate">{o.id}</div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">{new Date(o.created_at).toLocaleDateString()} · {(o.items || []).length} item{(o.items || []).length === 1 ? "" : "s"}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-sm font-semibold text-[#0A1F5C]">₹{o.total.toLocaleString()}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusTone(o.return_status || o.status)}`}>
                        {(o.return_status || o.status || "").replace(/_/g, " ")}
                      </span>
                    </div>
                    <ChevronRight size={16} className="text-[#94A3B8] shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Expanded sections */}
        {openSection === "profile" && (
          <section data-testid="section-profile" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 mt-8 shadow-sm">
            <SectionHeader title="Edit profile" onClose={() => setOpenSection(null)} />
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <Field label="Name"><input data-testid="cust-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
              <Field label="Age"><input data-testid="cust-age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
              <Field label="Email (optional)" full><input data-testid="cust-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none text-[#0A1F5C]" /></Field>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={saveProfile} disabled={busy} data-testid="save-profile" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50 hover:bg-[#D97706] transition">
                <Save size={14} /> {busy ? "Saving…" : "Save profile"}
              </button>
            </div>
          </section>
        )}

        {openSection === "addresses" && (
          <section data-testid="section-addresses" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 mt-8 shadow-sm">
            <SectionHeader title="Saved addresses" onClose={() => setOpenSection(null)}>
              <button onClick={() => setAddrModal({ ...BLANK_ADDR, name: form.name, phone })} data-testid="add-address" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-semibold hover:bg-[#08174A] transition">
                <Plus size={13} /> Add new
              </button>
            </SectionHeader>
            {addresses.length === 0 ? (
              <div className="text-sm text-[#64748B] py-6 text-center">No addresses saved yet.</div>
            ) : (
              <div className="grid gap-2 mt-3">
                {addresses.map((a) => (
                  <div key={a.id} data-testid={`addr-${a.id}`} className="border border-[#E5E2DC] rounded-2xl p-4 flex items-start justify-between gap-3 hover:border-[#0A1F5C] transition">
                    <div className="flex-1 text-sm min-w-0">
                      <div className="font-semibold text-[#0A1F5C] flex items-center gap-2"><HomeIcon size={13} /> {a.label || "Home"}{a.name && <span className="text-[#64748B] font-normal">· {a.name}</span>}</div>
                      <div className="text-[#64748B] mt-0.5">{a.line1}</div>
                      {a.landmark && <div className="text-[11px] text-[#64748B]">Landmark: {a.landmark}</div>}
                      <div className="text-[11px] text-[#64748B]">{a.city || "Bhilai"} · {a.pincode} · {a.phone || phone}</div>
                    </div>
                    <button onClick={() => removeAddress(a.id)} data-testid={`del-addr-${a.id}`} className="text-rose-500 hover:bg-rose-50 p-2 rounded-full shrink-0"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {openSection === "orders" && (
          <section data-testid="section-orders" className="bg-white border border-[#E5E2DC] rounded-3xl p-5 sm:p-6 mt-8 shadow-sm">
            <SectionHeader title={`All orders (${orders.length})`} onClose={() => setOpenSection(null)} />
            {orders.length === 0 ? (
              <div className="text-sm text-[#64748B] py-6 text-center">No orders yet.</div>
            ) : (
              <div className="divide-y divide-[#E5E2DC] mt-3">
                {orders.map((o) => (
                  <Link key={o.id} to={`/orders/${o.id}`} data-testid={`order-${o.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-[#FDFBF7] -mx-3 px-3 rounded-xl transition">
                    {(o.items || [])[0]?.image
                      ? <img src={o.items[0].image} alt="" className="w-12 h-12 rounded-xl object-cover border border-[#E5E2DC]" />
                      : <div className="w-12 h-12 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC] grid place-items-center"><Package size={18} className="text-[#64748B]" /></div>}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[#0A1F5C] truncate">{o.id}</div>
                      <div className="text-[11px] text-[#64748B]">{new Date(o.created_at).toLocaleDateString()} · ₹{o.total.toLocaleString()}</div>
                    </div>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${statusTone(o.return_status || o.status)}`}>{(o.return_status || o.status || "").replace(/_/g, " ")}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Logout */}
        <div className="pt-8 flex justify-center pb-2">
          <button onClick={logout} data-testid="logout-button" className="inline-flex items-center gap-2 text-[#E68910] hover:bg-[#E68910]/10 rounded-full px-6 py-2 transition font-medium text-sm">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </main>

      {addrModal && <AddressModal address={addrModal} onCancel={() => setAddrModal(null)} onSave={saveAddress} />}
      <Footer />
    </div>
  );
}

function SectionHeader({ title, onClose, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg sm:text-xl font-display font-bold text-[#0A1F5C]">{title}</h2>
      <div className="flex items-center gap-2">
        {children}
        <button onClick={onClose} className="text-[#64748B] hover:text-[#0A1F5C] text-xl leading-none px-2" data-testid="section-close" aria-label="Close section">×</button>
      </div>
    </div>
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
            <Field label="Label"><select data-testid="addr-label" value={a.label} onChange={(e) => set("label", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white text-[#0A1F5C]">
              <option>Home</option><option>Office</option><option>Other</option>
            </select></Field>
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
