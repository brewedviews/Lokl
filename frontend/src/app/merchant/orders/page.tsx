"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Bike, CheckCircle2, MapPin, RotateCcw, MessageSquareWarning, Store, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { apiClient } from "@/lib/api-client";
import type { Order, Return, Complaint } from "@/types";

const RETURN_PILL: Record<string, { l: string; c: string }> = {
  requested: { l: "Return requested", c: "bg-[#E68910]/15 text-[#E68910]" },
  pickup_assigned: { l: "Pickup assigned", c: "bg-[#1A2B4C]/15 text-[#1A2B4C]" },
  arriving: { l: "Pickup arriving", c: "bg-purple-100 text-purple-700" },
  picked_up: { l: "Picked up", c: "bg-blue-100 text-blue-700" },
  completed: { l: "Return completed", c: "bg-green-100 text-green-700" },
};
const COMPLAINT_TYPE: Record<string, string> = {
  return: "Return", missing_item: "Missing item", damaged_item: "Damaged item",
  delivery_issue: "Delivery issue", general: "General",
};

interface AudioCtxRef { current: AudioContext | null }
type WindowWithWebkit = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function playLoudPing(ctxRef: AudioCtxRef) {
  try {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
      if (!AC) return;
      ctxRef.current = new AC();
    }
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const bell = (startAt: number) => {
      [880, 660].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = freq;
        const t = startAt + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.7, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.5);
      });
    };
    const now = ctx.currentTime + 0.02;
    [0, 0.8, 1.6].forEach((d) => bell(now + d));
  } catch { /* noop */ }
}

type OrderEx = Order & { my_state?: string; my_otp?: string; merchant_subtotal?: number; return_status?: string; is_multi_store?: boolean };
type ItemEx = Order["items"][number] & { images?: string[]; product_image?: string; thumbnail?: string };

function formatCountdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function PickupTimer({ expiresAt }: { expiresAt: string }) {
  const [label, setLabel] = useState(() => formatCountdown(expiresAt));
  useEffect(() => {
    const t = setInterval(() => setLabel(formatCountdown(expiresAt)), 30000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const expired = label === "Expired";
  return (
    <span className={`text-xs font-semibold tabular-nums ${expired ? "text-red-500" : "text-[#595959]"}`}>
      {expired ? "Expired" : `${label} left`}
    </span>
  );
}

export default function MerchantOrdersPage() {
  const [orders, setOrders] = useState<OrderEx[]>([]);
  const [returns, setReturns] = useState<Return[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [muted, setMuted] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [previewProduct, setPreviewProduct] = useState<{ name: string; image: string } | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    setMuted(localStorage.getItem("bf_orders_muted") === "1");
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.merchant.listOrders() as OrderEx[];
        const news = data.filter((o) => o.order_type !== "pickup" && (o.my_state === "pending" || (o.my_state === undefined && o.status === "pending_merchant")) && !seenIds.current.has(o.id));
        const newPendingPickups = data.filter((o) => o.order_type === "pickup" && o.status === "pending_pickup" && !seenIds.current.has(o.id));
        if (newPendingPickups.length > 0 && initialLoadDone.current && !muted) {
          playLoudPing(audioCtxRef);
          newPendingPickups.forEach((o) => toast.success(`New pickup request ${o.id}!`, { duration: 6000 }));
        }
        if (news.length > 0 && initialLoadDone.current && !muted) {
          playLoudPing(audioCtxRef);
          news.forEach((o) => {
            toast.success(`New order ${o.id}!`, { duration: 6000 });
          });
        }
        data.forEach((o) => seenIds.current.add(o.id));
        setOrders(data);
        initialLoadDone.current = true;
      } catch { /* noop */ }
      try {
        const [rs, cs] = await Promise.all([
          apiClient.get<Return[]>("/api/merchant/returns").then((r) => r.data).catch(() => []),
          apiClient.get<Complaint[]>("/api/merchant/complaints").then((r) => r.data).catch(() => []),
        ]);
        setReturns(rs); setComplaints(cs);
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
    if (!next) playLoudPing(audioCtxRef);
    toast(next ? "Order ping muted" : "Order ping enabled");
  };

  const refresh = async () => { const d = await api.merchant.listOrders() as OrderEx[]; setOrders(d); };
  const accept = async (id: string) => { await api.merchant.acceptOrder(id); toast.success("Order accepted — waiting for rider"); refresh(); };
  const handToRider = async (id: string) => { await api.merchant.handToRider(id); toast.success("Handed to rider · on the way"); refresh(); };

  const [accepting, setAccepting] = useState<string | null>(null);

  const acceptPickup = async (oid: string) => {
    setAccepting(oid);
    try {
      await apiClient.post(`/api/merchant/orders/${oid}/accept-pickup`, {});
      toast.success("Pickup accepted — customer notified with their code");
      refresh();
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Could not accept pickup";
      toast.error(msg);
    } finally {
      setAccepting(null);
    }
  };

  const confirmPickup = async (oid: string) => {
    setConfirming(oid);
    try {
      await apiClient.post(`/api/merchant/orders/${oid}/confirm-pickup`, {});
      toast.success("Pickup confirmed — order marked as delivered");
      refresh();
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Could not confirm pickup";
      toast.error(msg);
    } finally {
      setConfirming(null);
    }
  };

  const cancelPickup = async (oid: string) => {
    setCancelling(oid);
    try {
      await apiClient.post(`/api/merchant/orders/${oid}/cancel-pickup`, {});
      toast.success("Reservation cancelled");
      refresh();
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Could not cancel reservation";
      toast.error(msg);
    } finally {
      setCancelling(null);
    }
  };

  const myState = (o: OrderEx) => o.my_state || o.status;
  const pendingPickups = orders.filter((o) => o.order_type === "pickup" && o.status === "pending_pickup");
  const pickupReservations = orders.filter((o) => o.order_type === "pickup" && o.status === "reserved");
  const pending = orders.filter((o) => o.order_type !== "pickup" && (myState(o) === "pending" || (o.my_state === undefined && o.status === "pending_merchant")));
  const accepted = orders.filter((o) => o.order_type !== "pickup" && (myState(o) === "accepted"));
  const onWay = orders.filter((o) => myState(o) === "handed_off" || (o.my_state === undefined && o.status === "on_the_way"));
  const returning = orders.filter((o) => o.return_status && o.return_status !== "completed");
  const returned = orders.filter((o) => o.status === "returned");
  const history = orders.filter((o) => (myState(o) === "delivered" || ["delivered", "completed", "cancelled"].includes(o.status as string)) && !o.return_status && myState(o) !== "handed_off" && myState(o) !== "accepted" && myState(o) !== "pending");

  return (
    <div className="p-6 md:p-10">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 data-testid="orders-title" className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2">
            <Bell size={24} className={pending.length ? "text-[#E68910] animate-pulse" : "text-[#595959]"} /> Order requests
          </h1>
          <p className="text-[#595959] text-sm mt-1">{pending.length ? `${pending.length} pending — accept fast for happy customers!` : "No new orders right now."}</p>
        </div>
        <div className="flex items-center gap-2">
          {pending.length > 0 && <span className="px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-bold animate-pulse">{pending.length} NEW</span>}
          <button onClick={toggleMute} data-testid="toggle-ping-mute" className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border ${muted ? "border-[#E5E2DC] bg-white text-[#595959]" : "border-[#1A2B4C] bg-[#1A2B4C] text-white"}`}>
            {muted ? <BellOff size={13} /> : <Bell size={13} />} {muted ? "Ping muted" : "Ping on"}
          </button>
          <button onClick={() => playLoudPing(audioCtxRef)} data-testid="test-ping" className="text-xs font-semibold text-[#E68910] hover:underline">Test sound</button>
        </div>
      </div>

      {previewProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setPreviewProduct(null)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative bg-white rounded-2xl overflow-hidden shadow-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewProduct(null)} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60">
              <X size={14} />
            </button>
            <img src={previewProduct.image} alt={previewProduct.name} className="w-full aspect-[3/4] object-cover" />
            <div className="p-3 text-sm font-semibold text-[#1A2B4C]">{previewProduct.name}</div>
          </div>
        </div>
      )}

      {pendingPickups.length > 0 && (
        <section className="mb-8" data-testid="pending-pickups">
          <h2 className="font-display text-base font-bold text-[#1A2B4C] mb-1 flex items-center gap-2">
            <Store size={15} className="text-[#E68910]" /> Pickup requests <span className="text-xs font-normal text-[#595959]">({pendingPickups.length})</span>
          </h2>
          <p className="text-xs text-[#595959] mb-2">Accept or decline — customer is waiting for their pickup code.</p>
          <div className="space-y-2">
            {pendingPickups.map((o) => (
              <div key={o.id} data-testid={`pending-pickup-${o.id}`} className="bg-white border-2 border-[#E68910] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#E5E2DC]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold text-xs text-[#1A2B4C] truncate">{o.id}</span>
                    <span className="shrink-0 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-[#E68910]/10 text-[#E68910]">Pending</span>
                  </div>
                  <span className="font-bold text-xs text-[#1A2B4C] shrink-0">₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</span>
                </div>
                <div className="px-3 py-2 text-xs text-[#595959] space-y-0.5">
                  {o.items.map((it, i) => (
                    <div key={i}>{it.name} × {it.qty}{it.size ? ` (${it.size})` : ""}</div>
                  ))}
                </div>
                <div className="flex gap-2 px-3 pb-3">
                  <button
                    onClick={() => acceptPickup(o.id)}
                    disabled={accepting === o.id || cancelling === o.id}
                    data-testid={`accept-pickup-${o.id}`}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full bg-[#4F7363] text-white font-semibold text-xs hover:bg-[#3a5a4d] disabled:opacity-50"
                  >
                    <CheckCircle2 size={12} /> {accepting === o.id ? "Accepting…" : "Accept"}
                  </button>
                  <button
                    onClick={() => cancelPickup(o.id)}
                    disabled={accepting === o.id || cancelling === o.id}
                    data-testid={`decline-pickup-${o.id}`}
                    className="px-3 py-1.5 rounded-full border border-red-200 text-red-500 font-semibold text-xs hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <X size={12} /> {cancelling === o.id ? "Declining…" : "Decline"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {pickupReservations.length > 0 && (
        <section className="mb-8" data-testid="pickup-reservations">
          <h2 className="font-display text-base font-bold text-[#1A2B4C] mb-1 flex items-center gap-2">
            <Store size={15} className="text-[#4F7363]" /> Store pickups <span className="text-xs font-normal text-[#595959]">({pickupReservations.length})</span>
          </h2>
          <p className="text-xs text-[#595959] mb-2">Check the customer&apos;s code matches, then confirm.</p>
          <div className="space-y-2">
            {pickupReservations.map((o) => {
              return (
                <div key={o.id} data-testid={`pickup-${o.id}`} className="bg-white border border-[#4F7363]/40 rounded-xl overflow-hidden">
                  {/* Row 1: order ID + timer + price */}
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#E5E2DC]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-xs text-[#1A2B4C] truncate">{o.id}</span>
                      <span className="shrink-0 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-[#4F7363]/10 text-[#4F7363]">Pickup</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {o.pickup_expires_at && <PickupTimer expiresAt={o.pickup_expires_at} />}
                      <span className="font-bold text-xs text-[#1A2B4C]">₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</span>
                    </div>
                  </div>
                  {/* Row 2: thumbnails + inline code */}
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar flex-1">
                      {o.items.map((it, i) => {
                        const itEx = it as ItemEx;
                        const imgSrc = itEx.image || itEx.images?.[0] || itEx.product_image || itEx.thumbnail || null;
                        return (
                          <button
                            key={i}
                            onClick={() => imgSrc ? setPreviewProduct({ name: itEx.name, image: imgSrc }) : undefined}
                            title={`${it.name}${it.size ? ` (${it.size})` : ""} ×${it.qty}`}
                            className={`flex-shrink-0 w-9 h-11 rounded-lg overflow-hidden border border-[#E5E2DC] bg-[#F5F4F0] ${imgSrc ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                          >
                            {imgSrc ? (
                              <img src={imgSrc} alt={it.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-[#E5E2DC] flex items-center justify-center text-[10px] font-bold text-[#9CA3AF]">
                                {it.name?.[0]?.toUpperCase() || "P"}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {o.pickup_code && (
                      <div className="shrink-0 bg-[#0A1F5C] rounded-lg px-3 py-1.5 text-center">
                        <div className="text-[8px] uppercase tracking-wider text-white/50 leading-none mb-0.5">Code</div>
                        <div data-testid={`pickup-code-${o.id}`} className="font-display text-xl font-bold tracking-[0.3em] tabular-nums text-[#4F7363] leading-none">{o.pickup_code}</div>
                      </div>
                    )}
                  </div>
                  {/* Row 3: actions */}
                  <div className="flex gap-2 px-3 pb-3">
                    <button
                      onClick={() => confirmPickup(o.id)}
                      disabled={confirming === o.id || cancelling === o.id}
                      data-testid={`confirm-pickup-${o.id}`}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full bg-[#4F7363] text-white font-semibold text-xs hover:bg-[#3a5a4d] disabled:opacity-50"
                    >
                      <CheckCircle2 size={12} /> {confirming === o.id ? "Confirming…" : "Mark as picked up"}
                    </button>
                    <button
                      onClick={() => cancelPickup(o.id)}
                      disabled={confirming === o.id || cancelling === o.id}
                      data-testid={`cancel-pickup-${o.id}`}
                      className="px-3 py-1.5 rounded-full border border-red-200 text-red-500 font-semibold text-xs hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <X size={12} /> {cancelling === o.id ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3 mb-10">
        {pending.length === 0 ? (
          <div className="p-8 bg-white border border-dashed border-[#E5E2DC] rounded-2xl text-center text-sm text-[#595959]">
            You&apos;ll hear a ping here the moment a customer places an order.
          </div>
        ) : pending.map((o) => (
          <div key={o.id} data-testid={`order-${o.id}`} className="bg-white border-2 border-[#E68910] rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <div className="font-display text-lg font-bold text-[#1A2B4C]">{o.id}</div>
                <div className="text-xs text-[#595959]">{new Date(o.created_at).toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="font-display text-2xl font-bold text-[#4F7363]">₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                <div className="text-xs text-[#595959]">{o.payment_method}</div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3 mb-4">
              <div className="text-sm">
                <div className="text-[10px] uppercase tracking-widest text-[#595959]">Customer</div>
                <div className="font-semibold">{o.customer?.name || o.address?.name || "Customer"}</div>
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
            <button onClick={() => accept(o.id)} data-testid={`accept-${o.id}`} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#4F7363] text-white font-semibold hover:bg-[#3a5a4d]">
              <CheckCircle2 size={14} /> Accept order
            </button>
          </div>
        ))}
      </section>

      {accepted.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-3">Awaiting rider pickup</h2>
          <p className="text-xs text-[#595959] mb-3">Match the 4-digit OTP with the rider before handing the package over.</p>
          <div className="space-y-3">
            {accepted.map((o) => (
              <div key={o.id} className="bg-white border-2 border-[#E68910]/40 rounded-2xl p-4" data-testid={`accepted-${o.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                    <div className="text-xs text-[#595959]">{o.customer?.name || o.address?.name || "Customer"} · {o.address?.pincode || ""}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] uppercase tracking-widest text-[#595959]">Rider OTP</div>
                    <div data-testid={`otp-${o.id}`} className="font-display text-3xl font-bold text-[#E68910] tracking-[0.2em] tabular-nums">{o.my_otp || o.otp || "----"}</div>
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
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-3">On the way</h2>
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
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-3 flex items-center gap-2"><RotateCcw size={18} className="text-[#E68910]" /> Returning <span className="text-xs font-normal text-[#595959]">({returning.length})</span></h2>
          <div className="space-y-2">
            {returning.map((o) => {
              const ret = returns.find((r) => r.order_id === o.id);
              const meta = RETURN_PILL[o.return_status as string] || { l: o.return_status || "—", c: "bg-zinc-100 text-zinc-700" };
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
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-3">Returned <span className="text-xs font-normal text-[#595959]">({returned.length})</span></h2>
          <div className="space-y-2">
            {returned.map((o) => (
              <div key={o.id} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap" data-testid={`returned-${o.id}`}>
                <div>
                  <div className="font-semibold text-[#1A2B4C]">{o.id} · ₹{(o.merchant_subtotal ?? o.total).toLocaleString()}</div>
                  <div className="text-[11px] text-[#595959]">{new Date(o.created_at).toLocaleString()} · {o.items.length} item(s)</div>
                </div>
                <span className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-700">Returned</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {complaints.length > 0 && (
        <section className="mb-10" data-testid="merchant-complaints">
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-3 flex items-center gap-2"><MessageSquareWarning size={18} className="text-[#E68910]" /> Customer complaints <span className="text-xs font-normal text-[#595959]">({complaints.length})</span></h2>
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
              </div>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-bold text-[#1A2B4C] mb-3">Order history</h2>
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
  );
}
