import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { User, Phone, Save, Package, MapPin, Plus, Trash2, Home as HomeIcon } from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import api from "../lib/api";
import { toast } from "sonner";

const BLANK_ADDR = { name: "", phone: "", label: "Home", line1: "", landmark: "", city: "Bhilai", pincode: "" };

export default function CustomerAccount() {
  const [phone, setPhone] = useState(localStorage.getItem("bf_customer_phone") || "");
  const [hasPhone, setHasPhone] = useState(!!localStorage.getItem("bf_customer_phone"));
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: "", age: "", email: "" });
  const [addrModal, setAddrModal] = useState(null); // null | {address-obj}
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!phone) return;
    try {
      const { data } = await api.get(`/customer/${phone}`);
      setData(data);
      const c = data.customer || {};
      setForm({ name: c.name || "", age: c.age || "", email: c.email || "" });
    } catch { setData({ customer: { phone, addresses: [] }, orders: [] }); }
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
        phone, name: form.name, age: form.age ? Number(form.age) : null,
        email: form.email,
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
      toast.success("Address saved");
      setAddrModal(null);
      load();
    } catch { toast.error("Failed to save address"); }
  };

  const removeAddress = async (aid) => {
    if (!window.confirm("Remove this address?")) return;
    await api.delete(`/customer/${phone}/addresses/${aid}`);
    load();
  };

  const addresses = data?.customer?.addresses || [];
  const orders = data?.orders || [];

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <h1 className="display text-4xl font-bold text-[#1A2B4C]">My account</h1>
        <p className="text-[#595959] text-sm mt-1">Save your details for one-tap checkout and track past orders.</p>

        {!hasPhone ? (
          <form onSubmit={enterPhone} className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6">
            <div className="text-[11px] uppercase tracking-widest text-[#595959] mb-2">Your mobile number</div>
            <div className="flex items-center gap-3">
              <Phone size={16} className="text-[#E68910]" />
              <input data-testid="phone-lookup" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" className="flex-1 px-3 py-2.5 rounded-xl border border-[#E5E2DC] outline-none" />
              <button type="submit" data-testid="continue-account" className="px-5 py-2.5 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold">Continue</button>
            </div>
          </form>
        ) : (
          <>
            <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="display text-xl font-bold text-[#1A2B4C] flex items-center gap-2"><User size={18} /> Profile</h2>
                <div className="text-xs text-[#595959]">📱 {phone}</div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Name"><input data-testid="cust-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
                <Field label="Age"><input data-testid="cust-age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
                <Field label="Email (optional)" full><input data-testid="cust-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
              </div>
              <div className="flex justify-end">
                <button onClick={saveProfile} disabled={busy} data-testid="save-profile" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50">
                  <Save size={14} /> {busy ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>

            <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="display text-xl font-bold text-[#1A2B4C] flex items-center gap-2"><MapPin size={18} /> Saved addresses</h2>
                <button onClick={() => setAddrModal({ ...BLANK_ADDR, name: form.name, phone })} data-testid="add-address" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1A2B4C] text-white text-xs font-semibold hover:bg-[#101D36]">
                  <Plus size={13} /> Add address
                </button>
              </div>

              {addresses.length === 0 ? (
                <div className="text-sm text-[#595959]">No addresses saved yet. Add one for one-tap checkout.</div>
              ) : (
                <div className="grid gap-2">
                  {addresses.map((a) => (
                    <div key={a.id} data-testid={`addr-${a.id}`} className="border border-[#E5E2DC] rounded-2xl p-4 flex items-start justify-between gap-3">
                      <div className="flex-1 text-sm">
                        <div className="font-semibold text-[#1A2B4C] flex items-center gap-2">
                          <HomeIcon size={13} /> {a.label || "Home"}
                          {a.name && <span className="text-[#595959] font-normal">· {a.name}</span>}
                        </div>
                        <div className="text-[#595959] mt-0.5">{a.line1}</div>
                        {a.landmark && <div className="text-[11px] text-[#595959]">Landmark: {a.landmark}</div>}
                        <div className="text-[11px] text-[#595959]">{a.city || "Bhilai"} · {a.pincode} · {a.phone || phone}</div>
                      </div>
                      <button onClick={() => removeAddress(a.id)} data-testid={`del-addr-${a.id}`} className="text-red-500 hover:bg-red-50 p-2 rounded-full"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6">
              <h2 className="display text-xl font-bold text-[#1A2B4C] mb-4 flex items-center gap-2"><Package size={18} /> Past orders</h2>
              {orders.length === 0 ? <div className="text-sm text-[#595959]">No orders yet.</div> :
                <div className="space-y-2 text-sm">
                  {orders.map((o) => (
                    <Link key={o.id} to={`/orders/${o.id}`} className="flex items-center justify-between p-3 bg-[#FDFBF7] rounded-xl hover:bg-[#FAF7EE]">
                      <div><div className="font-semibold">{o.id}</div><div className="text-xs text-[#595959]">{new Date(o.created_at).toLocaleString()} · {o.status}</div></div>
                      <div className="font-semibold text-[#1A2B4C]">₹{o.total.toLocaleString()}</div>
                    </Link>
                  ))}
                </div>}
            </div>
          </>
        )}
      </div>

      {addrModal && (
        <AddressModal address={addrModal} onCancel={() => setAddrModal(null)} onSave={saveAddress} />
      )}

      <Footer />
    </div>
  );
}

function AddressModal({ address, onCancel, onSave }) {
  const [a, setA] = useState(address);
  const set = (k, v) => setA((p) => ({ ...p, [k]: v }));
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" data-testid="address-modal">
        <h3 className="display text-xl font-bold text-[#1A2B4C] mb-4">Add address</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label"><select data-testid="addr-label" value={a.label} onChange={(e) => set("label", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none bg-white">
              <option>Home</option><option>Office</option><option>Other</option>
            </select></Field>
            <Field label="Name"><input data-testid="addr-name" value={a.name} onChange={(e) => set("name", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
          </div>
          <Field label="Address line"><textarea data-testid="addr-line1" value={a.line1} onChange={(e) => set("line1", e.target.value)} rows={2} placeholder="House no, street, area" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
          <Field label="Landmark (optional)"><input data-testid="addr-landmark" value={a.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="e.g. Opposite SBI / near Globe Chowk" className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City"><input data-testid="addr-city" value={a.city} onChange={(e) => set("city", e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
            <Field label="Pincode"><input data-testid="addr-pin" value={a.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
          </div>
          <Field label="Phone"><input data-testid="addr-phone" value={a.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
        </div>
        <div className="flex gap-2 pt-5">
          <button onClick={onCancel} className="flex-1 px-5 py-2.5 rounded-full border border-[#E5E2DC]">Cancel</button>
          <button onClick={() => onSave(a)} data-testid="save-address" className="flex-1 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold">Save address</button>
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, children, full }) => (
  <label className={`block ${full ? "md:col-span-2" : ""}`}>
    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>
    {children}
  </label>
);
