import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { User, Phone, Save, Package } from "lucide-react";
import ConsumerHeader from "../components/consumer/ConsumerHeader";
import Footer from "../components/consumer/Footer";
import api from "../lib/api";
import { toast } from "sonner";

export default function CustomerAccount() {
  const [phone, setPhone] = useState(localStorage.getItem("bf_customer_phone") || "");
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: "", age: "", email: "", address: { line1: "", city: "", pincode: "" } });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!phone) return;
    try {
      const { data } = await api.get(`/customer/${phone}`);
      setData(data);
      const c = data.customer || {};
      setForm({
        name: c.name || "", age: c.age || "", email: c.email || "",
        address: c.last_address || { line1: "", city: "", pincode: "" },
      });
    } catch { setData(null); }
  };

  useEffect(() => { if (phone) load(); /* eslint-disable-next-line */ }, []);

  const lookup = async (e) => { e.preventDefault(); localStorage.setItem("bf_customer_phone", phone); await load(); };

  const save = async () => {
    if (!phone) return toast.error("Enter your phone first");
    setBusy(true);
    try {
      await api.post("/customer/upsert", {
        phone, name: form.name, age: form.age ? Number(form.age) : null,
        email: form.email, address: form.address,
      });
      toast.success("Profile saved"); await load();
    } catch { toast.error("Failed to save"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <ConsumerHeader />
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <h1 className="display text-4xl font-bold text-[#1A2B4C]">My account</h1>
        <p className="text-[#595959] text-sm mt-1">Save your details for one-tap checkout and track past orders.</p>

        <form onSubmit={lookup} className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-5 flex items-center gap-3">
          <Phone size={16} className="text-[#E68910]" />
          <input data-testid="phone-lookup" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your mobile number" className="flex-1 px-3 py-2 rounded-xl border border-[#E5E2DC] outline-none" />
          <button type="submit" className="px-5 py-2.5 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold">View account</button>
        </form>

        {phone && (
          <>
            <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6 space-y-4">
              <h2 className="display text-xl font-bold text-[#1A2B4C] flex items-center gap-2"><User size={18} /> Profile</h2>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Name"><input data-testid="cust-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
                <Field label="Age"><input data-testid="cust-age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
                <Field label="Email (optional)"><input data-testid="cust-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
                <Field label="Pincode"><input data-testid="cust-pin" value={form.address.pincode} onChange={(e) => setForm({ ...form, address: { ...form.address, pincode: e.target.value } })} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
                <Field label="Address" full><textarea data-testid="cust-addr" value={form.address.line1} onChange={(e) => setForm({ ...form, address: { ...form.address, line1: e.target.value } })} rows={2} className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] outline-none" /></Field>
              </div>
              <div className="flex justify-end">
                <button onClick={save} disabled={busy} data-testid="save-profile" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#E68910] text-white font-semibold disabled:opacity-50">
                  <Save size={14} /> {busy ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>

            <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6">
              <h2 className="display text-xl font-bold text-[#1A2B4C] mb-4 flex items-center gap-2"><Package size={18} /> Past orders</h2>
              {!data?.orders?.length ? <div className="text-sm text-[#595959]">No orders yet.</div> :
                <div className="space-y-2 text-sm">
                  {data.orders.map((o) => (
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
      <Footer />
    </div>
  );
}

const Field = ({ label, children, full }) => (
  <label className={`block ${full ? "md:col-span-2" : ""}`}>
    <div className="text-[11px] font-semibold uppercase tracking-widest text-[#595959] mb-1.5">{label}</div>
    {children}
  </label>
);
