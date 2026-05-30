import React, { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Bike, CheckCircle2, MapPin, RotateCcw, MessageSquareWarning } from "lucide-react";
import MerchantLayout from "../components/merchant/MerchantLayout";
import api from "../lib/api";
import { toast } from "sonner";

const RETURN_PILL = {
  requested: { l: "Return requested", c: "bg-[#E68910]/15 text-[#E68910]" },
  pickup_assigned: { l: "Pickup assigned", c: "bg-[#1A2B4C]/15 text-[#1A2B4C]" },
  arriving: { l: "Pickup arriving", c: "bg-purple-100 text-purple-700" },
  picked_up: { l: "Picked up", c: "bg-blue-100 text-blue-700" },
  completed: { l: "Return completed", c: "bg-green-100 text-green-700" },
};
const COMPLAINT_TYPE = {
  return: "Return",
  missing_item: "Missing item",
  damaged_item: "Damaged item",
  delivery_issue: "Delivery issue",
  general: "General",
};

// Web Audio loud-bell ping (no audio file dependency).
// Plays a 3-pulse two-tone bell at ~0.7 gain (significantly louder than a wav beep).
function playLoudPing(ctxRef) {
  try {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctxRef.current = new AC();
    }
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const bell = (startAt) => {
      [880, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = startAt + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.7, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    };
    const now = ctx.currentTime + 0.02;
    [0, 0.8, 1.6].forEach((d) => bell(now + d));
  } catch { /* noop */ }
}

export default function MerchantOrders() {
  const [orders, setOrders] = useState([]);
  const [returns, setReturns] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [muted, setMuted] = useState(() => localStorage.getItem("bf_orders_muted") === "1");
  const seenIds = useRef(new Set());
  const audioCtxRef = useRef(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const load = async () => {
      try {
        const { data } = await api.get("/merchant/orders");
        const news = data.filter((o) => (o.my_state === "pending" || (o.my_state === undefined && o.status === "pending_merchant")) && !seenIds.current.has(o.id));
        // Skip ping on the very first load (avoid blasting on tab open with backlog)
        if (news.length > 0 && initialLoadDone.current && !muted) {
          playLoudPing(audioCtxRef);
          news.forEach((o) => {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              try { new Notification("New order on Lokl", { body: `${o.id} · ₹${o.merchant_subtotal ?? o.total}` }); } catch { /* noop */ }
            }
            toast.success(`New order ${o.id}!`, { duration: 6000 });
          });
        }
        data.forEach((o) => seenIds.current.add(o.id));
        setOrders(data);
        initialLoadDone.current = true;
      } catch { /* noop */ }
      try {
        const [{ data: rs }, { data: cs }] = await Promise.all([
          api.get("/merchant/returns"),
          api.get("/merchant/complaints"),
        ]);
        setReturns(Array.isArray(rs) ? rs : []);
        setComplaints(Array.isArray(cs) ? cs : []);
      } catch { /* noop */ }
    };
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, [muted]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem("bf_orders_muted", next ? "1" : "0");
    if (!next) {
      // Unmute → play a short test bell so merchant knows it works
      playLoudPing(audioCtxRef);
    }
    toast(next ? "Order ping muted" : "Order ping enabled");
  };

  const testPing = () => playLoudPing(audioCtxRef);

  const accept = async (id) => { await api.post(`/merchant/orders/${id}/accept`); toast.success("Order accepted — waiting for rider"); refresh(); };
  const handToRider = async (id) => { await api.post(`/merchant/orders/${id}/handed-to-rider`); toast.success("Handed to rider · on the way"); refresh(); };
  const refresh = async () => { const { data } = await api.get("/merchant/orders"); setOrders(data); };

  // Bucket per THIS merchant's state (multi-store orders accept independently)
  const myState = (o) => o.my_state || o.status; // legacy fallback
  const pending = orders.filter((o) => myState(o) === "pending" || (o.my_state === undefined && o.status === "pending_merchant"));
  const accepted = orders.filter((o) => myState(o) === "accepted");
  const onWay = orders.filter((o) => myState(o) === "handed_off" || (o.my_state === undefined && o.status === "on_the_way"));
  const returning = orders.filter((o) => o.return_status && o.return_status !== "completed");
  const returned = orders.filter((o) => o.status === "returned");
  const history = orders.filter((o) => (myState(o) === "delivered" || ["delivered", "completed", "cancelled"].includes(o.status)) && !o.return_status && myState(o) !== "handed_off" && myState(o) !== "accepted" && myState(o) !== "pending");

  return (
    <MerchantLayout>
      <div className="p-6 md:p-10">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 data-testid="orders-title" className="display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2">
              <Bell size={24} className={pending.length ? "text-[#E68910] animate-pulse" : "text-[#595959]"} />
              Order requests
            </h1>
            <p className="text-[#595959] text-sm mt-1">{pending.length ? `${pending.length} pending — accept fast for happy customers!` : "No new orders right now."}</p>
          </div>
          <div className="flex items-center gap-2">
            {pending.length > 0 && <span className="px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-bold animate-pulse">{pending.length} NEW</span>}
            <button
              onClick={toggleMute}
              data-testid="toggle-ping-mute"
              title={muted ? "Order ping is muted — click to enable" : "Order ping is on — click to mute"}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border ${muted ? "border-[#E5E2DC] bg-white text-[#595959]" : "border-[#1A2B4C] bg-[#1A2B4C] text-white"}`}>
              {muted ? <BellOff size={13} /> : <Bell size={13} />} {muted ? "Ping muted" : "Ping on"}
            </button>
            <button onClick={testPing} data-testid="test-ping" className="text-xs font-semibold text-[#E68910] hover:underline">Test sound</button>
          </div>
        </div>

        <section className="space-y-3 mb-10">
          {pending.length === 0 ? (
            <div className="p-8 bg-white border border-dashed border-[#E5E2DC] rounded-2xl text-center text-sm text-[#595959]">
              You'll hear a ping here the moment a customer places an order.
            </div>
          ) : pending.map((o) => (
            <div key={o.id} data-testid={`order-${o.id}`} className="bg-white border-2 border-[#E68910] rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <div className="display text-lg font-bold text-[#1A2B4C]">{o.id}</div>
                  <div className="text-xs text-[#595959]">{new Date(o.created_at).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="display text-2xl font-bold text-[#4F7363]">₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                  <div className="text-xs text-[#595959]">{o.payment_method}</div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3 mb-4">
                <div className="text-sm">
                  <div className="text-[10px] uppercase tracking-widest text-[#595959]">Customer</div>
                  <div className="font-semibold">{o.customer?.name || o.address?.name || "Customer"}</div>
                  <div className="text-[11px] text-[#595959]">Contact details handled by Lokl ops.</div>
                </div>
                <div className="text-sm">
                  <div className="text-[10px] uppercase tracking-widest text-[#595959]">Delivery area</div>
                  <div className="flex items-start gap-1 text-xs"><MapPin size={11} className="mt-0.5 shrink-0 text-[#E68910]" /> {(o.address?.landmark || o.address?.line1?.split(",").slice(-1)[0] || "Bhilai").trim()} · {o.address?.pincode}</div>
                </div>
              </div>
              <div className="space-y-1 mb-4 text-sm">
                {o.items.map((it, i) => (
                  <div key={i} className="flex justify-between"><span>{it.name} × {it.qty}{it.size ? ` (${it.size})` : ""}</span><span>₹{(it.price * it.qty).toLocaleString()}</span></div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => accept(o.id)} data-testid={`accept-${o.id}`} className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#4F7363] text-white font-semibold hover:bg-[#3a5a4d]">
                  <CheckCircle2 size={14} /> Accept order
                </button>
              </div>
              <p className="text-[11px] text-[#595959] mt-3 text-center">
                Can't fulfil this order? Call our ops team — Lokl will cancel it on your behalf so the customer's refund is auto-initiated.
              </p>
            </div>
          ))}
        </section>

        {accepted.length > 0 && (
          <section className="mb-10">
            <h2 className="display text-xl font-bold text-[#1A2B4C] mb-3">Awaiting rider pickup</h2>
            <p className="text-xs text-[#595959] mb-3">Match the 4-digit OTP with the rider before handing the package over. Same OTP will be shared with the customer for final delivery.</p>
            <div className="space-y-3">
              {accepted.map((o) => (
                <div key={o.id} className="bg-white border-2 border-[#E68910]/40 rounded-2xl p-4" data-testid={`accepted-${o.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                      <div className="text-xs text-[#595959]">{o.customer?.name || o.address?.name || "Customer"} · {o.address?.pincode || ""}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <div className="text-[9px] uppercase tracking-widest text-[#595959]">Rider OTP</div>
                        <div data-testid={`otp-${o.id}`} className="display text-3xl font-bold text-[#E68910] tracking-[0.2em] tabular-nums">{o.my_otp || o.otp || "----"}</div>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handToRider(o.id)} data-testid={`hand-rider-${o.id}`} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#1A2B4C] text-white text-sm font-semibold hover:bg-[#101D36]">
                    <Bike size={14} /> Handed to rider
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {onWay.length > 0 && (
          <section className="mb-10">
            <h2 className="display text-xl font-bold text-[#1A2B4C] mb-3">On the way</h2>
            <div className="space-y-2">
              {onWay.map((o) => (
                <div key={o.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3" data-testid={`onway-${o.id}`}>
                  <div>
                    <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                    <div className="text-xs text-[#595959]">{o.is_multi_store ? "Your items handed to rider · OTP " : "Rider en-route to customer · OTP "}{o.my_otp || o.otp}</div>
                  </div>
                  <span className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">On the way</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {returning.length > 0 && (
          <section className="mb-10" data-testid="merchant-returning">
            <h2 className="display text-xl font-bold text-[#1A2B4C] mb-3 flex items-center gap-2"><RotateCcw size={18} className="text-[#E68910]" /> Returning <span className="text-xs font-normal text-[#595959]">({returning.length})</span></h2>
            <div className="space-y-2">
              {returning.map((o) => {
                const ret = returns.find((r) => r.order_id === o.id);
                const meta = RETURN_PILL[o.return_status] || { l: o.return_status || "—", c: "bg-zinc-100 text-zinc-700" };
                return (
                  <div key={o.id} className="bg-white border border-[#E68910]/30 rounded-2xl p-4" data-testid={`returning-${o.id}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                        <div className="text-[11px] text-[#595959]">{new Date(o.created_at).toLocaleString()} · {o.items.length} item(s)</div>
                      </div>
                      <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-full ${meta.c}`}>{meta.l}</span>
                    </div>
                    {ret && (
                      <div className="mt-3 pt-3 border-t border-dashed border-[#E5E2DC] grid sm:grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-[#595959]">Reason</div>
                          <div className="text-[#1A2B4C] font-medium" data-testid={`return-reason-${o.id}`}>{ret.reason}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-[#595959]">Return ID · Pickup OTP</div>
                          <div className="text-[#1A2B4C] font-medium">{ret.id} · <span className="tabular-nums tracking-widest">{ret.otp}</span></div>
                        </div>
                        <div className="sm:col-span-2">
                          <div className="text-[10px] uppercase tracking-widest text-[#595959] mb-0.5">Items to be returned</div>
                          <div className="space-y-0.5">
                            {(ret.items || []).map((it, i) => (
                              <div key={i} className="text-[#1A2B4C]">• {it.name} × {it.qty}{it.size ? ` (${it.size})` : ""}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {returned.length > 0 && (
          <section className="mb-10" data-testid="merchant-returned">
            <h2 className="display text-xl font-bold text-[#1A2B4C] mb-3 flex items-center gap-2">Returned <span className="text-xs font-normal text-[#595959]">({returned.length})</span></h2>
            <div className="space-y-2">
              {returned.map((o) => {
                const ret = returns.find((r) => r.order_id === o.id);
                return (
                  <div key={o.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap" data-testid={`returned-${o.id}`}>
                    <div>
                      <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                      <div className="text-[11px] text-[#595959]">{new Date(o.created_at).toLocaleString()} · {o.items.length} item(s){ret?.reason ? ` · ${ret.reason}` : ""}</div>
                    </div>
                    <span className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-700">Returned</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {complaints.length > 0 && (
          <section className="mb-10" data-testid="merchant-complaints">
            <h2 className="display text-xl font-bold text-[#1A2B4C] mb-3 flex items-center gap-2"><MessageSquareWarning size={18} className="text-[#E68910]" /> Customer complaints <span className="text-xs font-normal text-[#595959]">({complaints.length})</span></h2>
            <p className="text-[11px] text-[#595959] mb-3">Lokl ops will reach out for resolution. These are shared here so you have visibility into customer feedback against your orders.</p>
            <div className="space-y-2">
              {complaints.slice(0, 20).map((c) => (
                <div key={c.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4" data-testid={`complaint-${c.id}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-semibold text-[#1A2B4C]">{c.id} <span className="text-xs text-[#595959] font-normal">· order {c.order_id}</span></div>
                      <div className="text-[11px] text-[#595959]">{new Date(c.created_at).toLocaleString()} · {COMPLAINT_TYPE[c.type] || c.type}</div>
                    </div>
                    <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-full ${c.status === "resolved" ? "bg-green-100 text-green-700" : "bg-[#E68910]/15 text-[#E68910]"}`}>{c.status}</span>
                  </div>
                  <p className="text-sm text-[#1A2B4C] mt-2 whitespace-pre-wrap">{c.message}</p>
                  {c.resolution_note && <p className="text-[11px] text-[#595959] mt-1">Resolution: {c.resolution_note}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section>
            <h2 className="display text-xl font-bold text-[#1A2B4C] mb-3">Order history</h2>
            <div className="bg-white border border-[#E5E2DC] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFBF7] text-left text-xs uppercase text-[#595959]">
                  <tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">When</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Total</th></tr>
                </thead>
                <tbody>
                  {history.map((o) => (
                    <tr key={o.id} className="border-t border-[#E5E2DC]">
                      <td className="px-4 py-2 font-semibold">{o.id}</td>
                      <td className="px-4 py-2 text-xs text-[#595959]">{new Date(o.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${o.status === "accepted" ? "bg-[#4F7363]/15 text-[#4F7363]" : "bg-red-100 text-red-500"}`}>{o.status}</span></td>
                      <td className="px-4 py-2 text-right font-semibold">₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </MerchantLayout>
  );
}
