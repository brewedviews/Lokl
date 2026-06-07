"use client";

/**
 * Admin Customers tab — directory + per-customer order drill-down.
 *
 * Backend:
 *  GET /api/admin/customers?q=&limit=200   — directory (already enriched with order_count + total_spend)
 *  GET /api/admin/customers/{phone}        — { customer, orders[] }
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Search, X } from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";

interface CustomerRow {
  phone: string;
  name?: string;
  email?: string;
  order_count?: number;
  total_spend?: number;
  updated_at?: string;
}
interface OrderLite {
  id: string;
  total: number;
  status: string;
  created_at?: string;
  store_names?: string[];
}
interface CustomerDetail { customer: CustomerRow; orders: OrderLite[] }

export function CustomersTab() {
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CustomerDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const url = q ? `/api/admin/customers?q=${encodeURIComponent(q)}` : "/api/admin/customers";
      setItems(await adminFetch<CustomerRow[]>(url));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const openDetail = async (c: CustomerRow) => {
    try {
      setSelected(await adminFetch<CustomerDetail>(`/api/admin/customers/${encodeURIComponent(c.phone)}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="customers-panel">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Customers ({items.length})</h2>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#595959]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Phone, name, or email…"
            data-testid="customers-search"
            className="pl-8 pr-3 py-2 rounded-full border border-[#E5E2DC] text-sm w-64" />
        </div>
      </div>
      <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
            <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Lifetime spend</th><th className="px-4 py-3">Last seen</th></tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.phone} className="border-t border-[#E5E2DC] hover:bg-[#FDFBF7] cursor-pointer" data-testid={`customer-row-${c.phone}`} onClick={() => openDetail(c)}>
                <td className="px-4 py-3 font-semibold text-[#0A1F5C]">{c.name || "—"}<div className="text-[11px] text-[#595959] font-normal">{c.email || ""}</div></td>
                <td className="px-4 py-3 text-[#595959] font-mono">{c.phone}</td>
                <td className="px-4 py-3 text-right">{c.order_count ?? 0}</td>
                <td className="px-4 py-3 text-right font-semibold">₹{Math.round(c.total_spend ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-[#595959]">{c.updated_at?.slice(0, 16).replace("T", " ") || "—"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-[#595959]">No customers match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" data-testid="customer-detail">
            <div className="sticky top-0 bg-white border-b border-[#E5E2DC] px-6 py-4 flex items-center justify-between">
              <div>
                <div className="font-display text-xl font-bold text-[#0A1F5C]">{selected.customer.name || "Customer"}</div>
                <div className="text-xs text-[#595959] font-mono">{selected.customer.phone}</div>
              </div>
              <button onClick={() => setSelected(null)} data-testid="customer-detail-close" className="w-9 h-9 rounded-full bg-[#FDFBF7] flex items-center justify-center hover:bg-[#E5E2DC]">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-4">
              <div className="text-xs uppercase tracking-widest text-[#595959] mb-2">Recent orders</div>
              {selected.orders.length === 0 ? (
                <div className="text-sm text-[#595959]">No orders yet.</div>
              ) : (
                <div className="space-y-2">
                  {selected.orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between p-3 rounded-xl border border-[#E5E2DC]">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-[#0A1F5C]">{o.id}</div>
                        <div className="text-[11px] text-[#595959]">{(o.store_names || []).join(", ")}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-[#0A1F5C]">₹{Number(o.total).toLocaleString()}</div>
                        <div className="text-[10px] uppercase tracking-widest text-[#E68910]">{o.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
