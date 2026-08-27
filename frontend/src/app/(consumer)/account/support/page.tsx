"use client";

/**
 * Support page — rewritten entry flow.
 *
 * ROOT BUG FIXED: the old order picker called `GET /api/orders?limit=10`,
 * a route that has never existed on the backend (only `POST /api/orders`
 * and `GET /api/orders/{id}` do) — FastAPI answered 405, and the
 * `.catch(() => {})` silently swallowed it, so the picker always rendered
 * "No recent orders found" even for customers with real order history.
 * Fixed by calling the same endpoint the main Orders panel already uses:
 * `api.customers.get(phone)` -> `GET /api/customer/{phone}` -> `.orders`.
 *
 * FLOW REWORK: the old topic -> order_picker -> reason chain is collapsed
 * — recent orders now render directly on the entry screen (the order
 * itself already tells us what the issue is about, per the brief), each
 * row jumping straight to a per-order reason picker. "Something else?"
 * is a second, equally clear entry to a generic composer. The real
 * ticket/chat system underneath (POST /api/support/ticket, GET
 * /api/support/my-tickets, ticket replies) is unchanged — this only
 * reworks how a NEW ticket gets started.
 *
 * REASON VOCABULARY: backend's only real structured enum is
 * COMPLAINT_TYPES ("return"|"missing_item"|"damaged_item"|"delivery_issue"
 * |"general", server.py) — reused here as the label vocabulary (not
 * invented) rather than adding a new category field to the ticket
 * endpoint. Different status buckets show different labeled subsets of
 * the same real vocabulary.
 *
 * NEVER BLANK: orders-loading has explicit loading/error/empty states —
 * a failed fetch shows "Couldn't load your orders" + Retry, and "Contact
 * support" is always reachable regardless.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { apiClient } from "@/lib/api-client";
import { api } from "@/lib/api";
import { useCustomerAuthStore } from "@/stores";
import { toast } from "sonner";
import { Send, ChevronLeft, ChevronRight, Package, RefreshCw } from "lucide-react";
import type { Order } from "@/types";

type View = "list" | "reason" | "general" | "chat";
type ComplaintType = "return" | "missing_item" | "damaged_item" | "delivery_issue" | "general";

const GENERAL_CATEGORIES = ["Payment", "Account", "Delivery", "Product", "Other"] as const;

/** Reused, not invented — COMPLAINT_TYPES is the backend's own real enum
 *  (server.py). Different order-status buckets surface different
 *  labeled subsets of it. */
function reasonsFor(status: string): Array<{ label: string; type: ComplaintType }> {
  const s = (status || "").toLowerCase();
  if (s.includes("cancel") || s.includes("reject")) {
    return [
      { label: "Why was my order cancelled?", type: "general" },
      { label: "Payment or refund", type: "general" },
      { label: "Other", type: "general" },
    ];
  }
  if (s.includes("deliver") && !s.includes("pending")) {
    return [
      { label: "Damaged item", type: "damaged_item" },
      { label: "Missing item", type: "missing_item" },
      { label: "Return or refund", type: "return" },
      { label: "Delivery issue", type: "delivery_issue" },
      { label: "Other", type: "general" },
    ];
  }
  return [
    { label: "Delivery issue", type: "delivery_issue" },
    { label: "Missing item", type: "missing_item" },
    { label: "Other", type: "general" },
  ];
}

interface Message { sender: string; text: string; created_at: string; }
interface Ticket {
  id: string;
  order_id?: string;
  subject: string;
  status: string;
  messages: Message[];
  created_at: string;
}

function toIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function statusTone(s: string) {
  const x = (s || "").toLowerCase();
  if (x.includes("deliver") && !x.includes("pending")) return "text-emerald-700 bg-emerald-50";
  if (x.includes("cancel") || x.includes("reject")) return "text-rose-700 bg-rose-50";
  return "text-[#0A1F5C] bg-[#0A1F5C]/10";
}

function StatusPill({ status }: { status: string }) {
  const cfg =
    status === "open"
      ? { label: "Open", cls: "bg-[#E68910]/15 text-[#E68910]" }
      : status === "replied"
      ? { label: "Replied", cls: "bg-[#0A1F5C]/10 text-[#0A1F5C]" }
      : { label: "Closed", cls: "bg-[#E5E2DC] text-[#595959]" };
  return (
    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

export default function SupportPage() {
  const sp = useSearchParams();
  const prefillOrderId = sp.get("order_id") || "";
  const phone = useCustomerAuthStore((s) => s.phone) ?? "";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersState, setOrdersState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedOrder, setSelectedOrder] = useState(prefillOrderId);
  const [generalCategory, setGeneralCategory] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(prefillOrderId ? "reason" : "list");
  const [bypassDuplicateGuard, setBypassDuplicateGuard] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeTicketIdRef = useRef<string | null>(null);
  useEffect(() => { activeTicketIdRef.current = activeTicket?.id ?? null; }, [activeTicket]);

  const loadTickets = useCallback(async () => {
    try {
      const r = await apiClient.get<{ tickets: Ticket[] }>("/api/support/my-tickets");
      const list: Ticket[] = (r as { data: { tickets: Ticket[] } }).data?.tickets || [];
      setTickets(list);
      const id = activeTicketIdRef.current;
      if (id) {
        const fresh = list.find((t) => t.id === id);
        if (fresh) setActiveTicket(fresh);
      }
    } catch {
      // silently ignore — user may not be logged in
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    if (!phone) return;
    setOrdersState("loading");
    try {
      const { orders } = await api.customers.get(phone);
      setOrders(orders || []);
      setOrdersState("ready");
    } catch {
      setOrdersState("error");
    }
  }, [phone]);

  useEffect(() => {
    void loadTickets();
    void loadOrders();
  }, [loadTickets, loadOrders]);

  // Poll every 12s while in chat view so admin replies appear without a hard reload
  useEffect(() => {
    if (view !== "chat" || !activeTicket) return;
    const timerId = setInterval(() => { void loadTickets(); }, 12000);
    return () => clearInterval(timerId);
  }, [view, activeTicket?.id, loadTickets]);

  // Auto-scroll only when message count changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTicket?.messages?.length]);

  // Create ticket immediately from the reason picker (order path)
  const createTicketFromReason = async (reason: string) => {
    if (!selectedOrder) return;
    setSending(true);
    try {
      const shortId = selectedOrder.slice(-6).toUpperCase();
      const r = await apiClient.post<Ticket>("/api/support/ticket", {
        order_id: selectedOrder,
        subject: `${reason} — order #${shortId}`,
        message: reason,
      });
      const ticket = (r as { data: Ticket }).data;
      setTickets((prev) => [ticket, ...prev]);
      setActiveTicket(ticket);
      setView("chat");
    } catch {
      toast.error("Could not create request. Try emailing hello@shoplokl.in");
    } finally {
      setSending(false);
    }
  };

  // Create ticket from the general free-text composer (no order)
  const submitGeneralTicket = async () => {
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      const subject = generalCategory ? `${generalCategory}: General enquiry` : "General enquiry";
      const r = await apiClient.post<Ticket>("/api/support/ticket", {
        subject,
        message: newMessage.trim(),
      });
      const ticket = (r as { data: Ticket }).data;
      setTickets((prev) => [ticket, ...prev]);
      setActiveTicket(ticket);
      setView("chat");
      setNewMessage("");
      setGeneralCategory("");
    } catch {
      toast.error("Could not send message. Try emailing hello@shoplokl.in");
    } finally {
      setSending(false);
    }
  };

  const addReplyToActive = async () => {
    if (!activeTicket || !newMessage.trim()) return;
    setSending(true);
    const text = newMessage.trim();
    // Optimistic append so the UI feels instant
    const optimistic: Ticket = {
      ...activeTicket,
      messages: [
        ...activeTicket.messages,
        { sender: "customer", text, created_at: new Date().toISOString() },
      ],
    };
    setActiveTicket(optimistic);
    setNewMessage("");
    try {
      await apiClient.post(`/api/support/tickets/${activeTicket.id}/reply`, { message: text });
      // Re-fetch so server truth (incl. any concurrent admin reply) wins
      void loadTickets();
    } catch {
      // Rollback optimistic update
      setActiveTicket(activeTicket);
      setNewMessage(text);
      toast.error("Could not send message.");
    } finally {
      setSending(false);
    }
  };

  function goBack() {
    if (view === "chat") return setView("list");
    if (view === "reason") return prefillOrderId ? setView("list") : setView("list");
    if (view === "general") return setView("list");
    return setView("list");
  }

  const selectedOrderObj = orders.find((o) => o.id === selectedOrder);
  const headerTitle =
    view === "chat" ? (activeTicket?.subject || "Support chat")
    : view === "reason" ? "Need help with this order?"
    : view === "general" ? "How can we help?"
    : "Help & Support";

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E2DC] px-4 py-3 flex items-center gap-3 z-10">
          {view === "list" ? (
            <Link href="/account" className="text-[#0A1F5C] flex-shrink-0">
              <ChevronLeft size={20} />
            </Link>
          ) : (
            <button onClick={goBack} className="text-[#0A1F5C] flex-shrink-0">
              <ChevronLeft size={20} />
            </button>
          )}
          <h1 className="font-display text-base font-medium text-[#0A1F5C] flex-1 min-w-0 truncate">{headerTitle}</h1>
          {view === "chat" && activeTicket && <StatusPill status={activeTicket.status} />}
        </div>

        {/* PRIMARY SCREEN */}
        {view === "list" && (
          <div className="px-4 py-4 space-y-5">
            <p className="text-sm text-[#595959]">How can we help?</p>

            {/* A. Recent orders — tapping one goes straight to its own
                reason picker; the order itself already tells us what the
                issue is about. */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF] mb-2">Recent orders</p>
              {ordersState === "loading" ? (
                <div className="space-y-2">
                  {[1, 2].map((n) => (
                    <div key={n} className="bg-white border border-[#E5E2DC] rounded-2xl p-3 h-16 animate-pulse" />
                  ))}
                </div>
              ) : ordersState === "error" ? (
                <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 text-center">
                  <p className="text-sm font-semibold text-[#0A1F5C]">Couldn&apos;t load your orders</p>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">Please try again.</p>
                  <button onClick={() => void loadOrders()} className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-full bg-[#0A1F5C] text-white text-xs font-semibold">
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              ) : orders.length === 0 ? (
                <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4 text-center">
                  <p className="text-sm text-[#9CA3AF]">No recent orders yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 5).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => { setSelectedOrder(o.id); setBypassDuplicateGuard(false); setView("reason"); }}
                      data-testid={`support-order-${o.id}`}
                      className="w-full flex items-center gap-3 bg-white border border-[#E5E2DC] rounded-2xl p-3 hover:border-[#0A1F5C]/30 transition text-left"
                    >
                      {o.items?.[0]?.image ? (
                        <Image src={o.items[0].image} alt="" width={44} height={44} className="w-11 h-11 rounded-xl object-cover border border-[#E5E2DC] shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-[#FDFBF7] border border-[#E5E2DC] grid place-items-center shrink-0"><Package size={16} className="text-[#9CA3AF]" /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#0A1F5C] truncate">Order #{o.id.slice(-6).toUpperCase()}</p>
                        <p className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">
                          {new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ₹{Number(o.total).toLocaleString()}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full shrink-0 max-w-[90px] text-center leading-tight ${statusTone(o.status)}`}>{(o.status || "").replace(/_/g, " ")}</span>
                      <ChevronRight size={15} className="text-[#9CA3AF] shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* B. Generic support entry */}
            <button
              onClick={() => setView("general")}
              data-testid="support-something-else"
              className="w-full flex items-center justify-between p-4 bg-white border border-[#E5E2DC] rounded-2xl hover:border-[#0A1F5C] transition text-left"
            >
              <div>
                <p className="font-semibold text-[#0A1F5C] text-sm">Something else?</p>
                <p className="text-xs text-[#9CA3AF] mt-0.5">Account, payments, or anything else</p>
              </div>
              <ChevronRight size={16} className="text-[#9CA3AF] flex-shrink-0" />
            </button>

            {/* Past requests — the existing, working ticket history, kept
                as a secondary section rather than the entry point. */}
            {tickets.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#9CA3AF] mb-2">Your requests</p>
                <div className="space-y-2">
                  {tickets.map((t) => (
                    <button key={t.id} onClick={() => { setActiveTicket(t); setView("chat"); }}
                      className="w-full text-left bg-white border border-[#E5E2DC] rounded-2xl p-4 hover:border-[#0A1F5C]/30 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-[#0A1F5C] text-sm leading-snug">{t.subject}</p>
                        <StatusPill status={t.status} />
                      </div>
                      <p className="text-xs text-[#9CA3AF] mt-1.5">{toIST(t.created_at)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 bg-white border border-[#E5E2DC] rounded-2xl">
              <p className="font-semibold text-[#0A1F5C] text-sm mb-3">Other ways to reach us</p>
              <a href="mailto:hello@shoplokl.in" className="flex items-center gap-2 text-sm text-[#595959]">
                <span className="w-8 h-8 bg-[#FDFBF7] rounded-full flex items-center justify-center text-xs font-bold text-[#0A1F5C]">@</span>
                hello@shoplokl.in
              </a>
            </div>
          </div>
        )}

        {/* REASON PICKER — contextual to the selected order's status */}
        {view === "reason" && (() => {
          const existingOpenTicket = !bypassDuplicateGuard && tickets.find(
            (t) => t.order_id === selectedOrder && t.status !== "closed"
          );
          const reasons = reasonsFor(selectedOrderObj?.status || "");
          return (
            <div className="px-4 py-6 space-y-3">
              {selectedOrder && (
                <p className="text-xs text-[#9CA3AF] -mb-1">
                  Order #{selectedOrder.slice(-6).toUpperCase()}
                </p>
              )}
              {existingOpenTicket ? (
                <>
                  <div className="p-4 bg-[#E68910]/10 border border-[#E68910]/30 rounded-2xl">
                    <p className="font-semibold text-[#0A1F5C] text-sm mb-1">
                      You already have an open request for this order
                    </p>
                    <p className="text-xs text-[#595959]">{existingOpenTicket.subject}</p>
                  </div>
                  <button
                    onClick={() => { setActiveTicket(existingOpenTicket); setView("chat"); }}
                    className="w-full py-3.5 bg-[#0A1F5C] text-white rounded-2xl font-bold text-sm"
                  >
                    Open existing chat
                  </button>
                  <p className="text-center pt-1">
                    <button
                      onClick={() => setBypassDuplicateGuard(true)}
                      className="text-xs text-[#9CA3AF] underline underline-offset-2"
                    >
                      Start a new request anyway
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-[#595959] mb-1">What&apos;s the issue?</p>
                  {reasons.map(({ label }) => (
                    <button
                      key={label}
                      onClick={() => void createTicketFromReason(label)}
                      disabled={sending}
                      data-testid={`support-reason-${label}`}
                      className="w-full flex items-center justify-between p-4 bg-white border border-[#E5E2DC] rounded-2xl hover:border-[#0A1F5C] active:bg-[#0A1F5C]/5 transition text-left disabled:opacity-50"
                    >
                      <p className="font-semibold text-[#0A1F5C] text-sm">{label}</p>
                      <ChevronRight size={16} className="text-[#9CA3AF] flex-shrink-0" />
                    </button>
                  ))}
                  {sending && (
                    <p className="text-xs text-center text-[#9CA3AF] pt-1">Creating your request…</p>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* GENERIC SUPPORT COMPOSER — "Something else?" path */}
        {view === "general" && (
          <div className="px-4 py-4 space-y-4">
            <div>
              <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-2">
                Category (optional)
              </label>
              <div className="flex flex-wrap gap-2">
                {GENERAL_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setGeneralCategory(generalCategory === c ? "" : c)}
                    data-testid={`support-category-${c}`}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${generalCategory === c ? "bg-[#0A1F5C] text-white border-[#0A1F5C]" : "bg-white text-[#0A1F5C] border-[#E5E2DC]"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-2">
                How can we help?
              </label>
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Tell us what went wrong..."
                rows={5}
                data-testid="support-general-textarea"
                className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#0A1F5C] resize-none"
              />
            </div>
            <button onClick={() => void submitGeneralTicket()} disabled={!newMessage.trim() || sending}
              data-testid="support-send-request"
              className="w-full py-3.5 bg-[#0A1F5C] text-white rounded-xl font-bold disabled:opacity-50">
              {sending ? "Sending..." : "Send request"}
            </button>
          </div>
        )}

        {/* CHAT VIEW — real ticket thread, unchanged */}
        {view === "chat" && activeTicket && (
          <div className="flex flex-col" style={{ height: "calc(100vh - 57px - 56px - env(safe-area-inset-bottom, 0px))" }}>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-2">
              {activeTicket.messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.sender === "customer" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                    msg.sender === "customer"
                      ? "bg-[#0A1F5C] text-white rounded-br-sm"
                      : msg.sender === "bot"
                      ? "bg-[#F5F5F5] text-[#595959] rounded-bl-sm"
                      : "bg-[#E68910]/10 text-[#0A1F5C] rounded-bl-sm"
                  }`}>
                    {msg.sender === "admin" && (
                      <p className="text-[10px] font-bold text-[#E68910] mb-1">Lokl Support</p>
                    )}
                    {msg.sender === "bot" && (
                      <p className="text-[10px] font-bold text-[#9CA3AF] mb-1">Lokl Support Bot</p>
                    )}
                    <p>{msg.text}</p>
                  </div>
                  <p className="text-[10px] text-[#9CA3AF] mt-1 px-1">{toIST(msg.created_at)}</p>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {activeTicket.status === "closed" ? (
              <div className="border-t border-[#E5E2DC] px-4 py-3 bg-white text-center">
                <p className="text-xs text-[#9CA3AF]">
                  This ticket is closed. Raise a new request if you need further help.
                </p>
              </div>
            ) : (
              <div className="border-t border-[#E5E2DC] p-4 flex gap-2 bg-white">
                <input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void addReplyToActive(); } }}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#0A1F5C]"
                />
                <button onClick={() => void addReplyToActive()} disabled={!newMessage.trim() || sending}
                  className="w-10 h-10 bg-[#0A1F5C] text-white rounded-xl flex items-center justify-center disabled:opacity-50">
                  <Send size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
