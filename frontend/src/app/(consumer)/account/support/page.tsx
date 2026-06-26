"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { Send, ChevronLeft, ChevronRight } from "lucide-react";

const REASONS = [
  "Item damaged",
  "Wrong item received",
  "Item not as described",
  "Missing item",
  "Other",
] as const;

type View = "list" | "topic" | "order_picker" | "reason" | "general" | "chat";

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

function StatusPill({ status }: { status: string }) {
  const cfg =
    status === "open"
      ? { label: "Open", cls: "bg-[#E68910]/15 text-[#E68910]" }
      : status === "replied"
      ? { label: "Replied", cls: "bg-[#1A2B4C]/10 text-[#1A2B4C]" }
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

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [orders, setOrders] = useState<{ id: string; items?: Array<{ name?: string }> }[]>([]);
  const [selectedOrder, setSelectedOrder] = useState(prefillOrderId);
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

  const loadOrders = () => {
    apiClient
      .get("/api/orders?limit=10")
      .then((r) => {
        const d = (r as { data: unknown }).data;
        setOrders(
          Array.isArray(d)
            ? (d as typeof orders)
            : ((d as { orders?: typeof orders })?.orders ?? [])
        );
      })
      .catch(() => {});
  };

  useEffect(() => {
    void loadTickets();
    loadOrders();
  }, [loadTickets]);

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

  // Create ticket from the general free-text form (no order)
  const submitGeneralTicket = async () => {
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      const r = await apiClient.post<Ticket>("/api/support/ticket", {
        subject: "General enquiry",
        message: newMessage.trim(),
      });
      const ticket = (r as { data: Ticket }).data;
      setTickets((prev) => [ticket, ...prev]);
      setActiveTicket(ticket);
      setView("chat");
      setNewMessage("");
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
    if (view === "reason") return prefillOrderId ? setView("list") : setView("order_picker");
    if (view === "order_picker") return setView("topic");
    if (view === "general") return setView("topic");
    if (view === "topic") return setView("list");
    return setView("list");
  }

  const headerTitle =
    view === "chat" ? (activeTicket?.subject || "Support chat")
    : view === "reason" ? "What went wrong?"
    : view === "order_picker" ? "Select an order"
    : view === "topic" || view === "general" ? "New request"
    : "Help & Support";

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E2DC] px-4 py-3 flex items-center gap-3 z-10">
          {view === "list" ? (
            <Link href="/account" className="text-[#1A2B4C] flex-shrink-0">
              <ChevronLeft size={20} />
            </Link>
          ) : (
            <button onClick={goBack} className="text-[#1A2B4C] flex-shrink-0">
              <ChevronLeft size={20} />
            </button>
          )}
          <h1 className="font-bold text-[#1A2B4C] flex-1 min-w-0 truncate">{headerTitle}</h1>
          {view === "chat" && activeTicket && <StatusPill status={activeTicket.status} />}
          {view === "list" && (
            <button onClick={() => setView("topic")} className="text-sm font-semibold text-[#E68910] flex-shrink-0">
              New request
            </button>
          )}
        </div>

        {/* LIST VIEW */}
        {view === "list" && (
          <div className="px-4 py-4 space-y-3">
            {loading ? (
              [1, 2].map((n) => (
                <div key={n} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 animate-pulse">
                  <div className="flex items-start justify-between gap-2">
                    <div className="h-4 bg-[#E5E2DC] rounded w-40" />
                    <div className="h-4 bg-[#E5E2DC] rounded w-14" />
                  </div>
                  <div className="h-3 bg-[#F5F5F5] rounded w-24 mt-2" />
                </div>
              ))
            ) : tickets.length === 0 ? (
              <div className="text-center py-12">
                <p className="font-semibold text-[#1A2B4C] mb-1">No support requests yet</p>
                <p className="text-sm text-[#9CA3AF] mb-4">We are here to help</p>
                <button onClick={() => setView("topic")}
                  className="px-6 py-2.5 bg-[#1A2B4C] text-white rounded-xl text-sm font-semibold">
                  Raise a request
                </button>
              </div>
            ) : (
              tickets.map((t) => (
                <button key={t.id} onClick={() => { setActiveTicket(t); setView("chat"); }}
                  className="w-full text-left bg-white border border-[#E5E2DC] rounded-2xl p-4 hover:border-[#1A2B4C]/30 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-[#1A2B4C] text-sm leading-snug">{t.subject}</p>
                    <StatusPill status={t.status} />
                  </div>
                  <p className="text-xs text-[#9CA3AF] mt-1.5">{toIST(t.created_at)}</p>
                </button>
              ))
            )}

            <div className="mt-4 p-4 bg-white border border-[#E5E2DC] rounded-2xl">
              <p className="font-semibold text-[#1A2B4C] text-sm mb-3">Other ways to reach us</p>
              <a href="mailto:hello@shoplokl.in" className="flex items-center gap-2 text-sm text-[#595959]">
                <span className="w-8 h-8 bg-[#FDFBF7] rounded-full flex items-center justify-center text-xs font-bold text-[#1A2B4C]">@</span>
                hello@shoplokl.in
              </a>
            </div>
          </div>
        )}

        {/* TOPIC VIEW — "What's this about?" */}
        {view === "topic" && (
          <div className="px-4 py-6 space-y-3">
            <p className="text-sm text-[#595959] mb-1">What&apos;s this about?</p>
            <button
              onClick={() => setView("order_picker")}
              className="w-full flex items-center justify-between p-4 bg-white border border-[#E5E2DC] rounded-2xl hover:border-[#1A2B4C] transition text-left"
            >
              <div>
                <p className="font-semibold text-[#1A2B4C] text-sm">An order</p>
                <p className="text-xs text-[#9CA3AF] mt-0.5">Issue with a delivered item</p>
              </div>
              <ChevronRight size={16} className="text-[#9CA3AF] flex-shrink-0" />
            </button>
            <button
              onClick={() => setView("general")}
              className="w-full flex items-center justify-between p-4 bg-white border border-[#E5E2DC] rounded-2xl hover:border-[#1A2B4C] transition text-left"
            >
              <div>
                <p className="font-semibold text-[#1A2B4C] text-sm">Something else</p>
                <p className="text-xs text-[#9CA3AF] mt-0.5">Account, payments, or anything else</p>
              </div>
              <ChevronRight size={16} className="text-[#9CA3AF] flex-shrink-0" />
            </button>
          </div>
        )}

        {/* ORDER PICKER VIEW */}
        {view === "order_picker" && (
          <div className="px-4 py-4 space-y-2">
            {orders.length === 0 ? (
              <div className="text-center py-12">
                <p className="font-semibold text-[#1A2B4C] mb-1">No recent orders found</p>
                <p className="text-sm text-[#9CA3AF]">We couldn&apos;t find any orders on this account.</p>
              </div>
            ) : (
              orders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => { setSelectedOrder(o.id); setBypassDuplicateGuard(false); setView("reason"); }}
                  className="w-full flex items-center justify-between p-4 bg-white border border-[#E5E2DC] rounded-2xl hover:border-[#1A2B4C] transition text-left"
                >
                  <div>
                    <p className="font-semibold text-[#1A2B4C] text-sm">
                      Order #{(o.id || "").slice(-6).toUpperCase()}
                    </p>
                    {o.items?.[0]?.name && (
                      <p className="text-xs text-[#9CA3AF] mt-0.5 truncate max-w-[240px]">
                        {o.items[0].name}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-[#9CA3AF] flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        )}

        {/* REASON PICKER VIEW */}
        {view === "reason" && (() => {
          const existingOpenTicket = !bypassDuplicateGuard && tickets.find(
            (t) => t.order_id === selectedOrder && t.status !== "closed"
          );
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
                    <p className="font-semibold text-[#1A2B4C] text-sm mb-1">
                      You already have an open request for this order
                    </p>
                    <p className="text-xs text-[#595959]">{existingOpenTicket.subject}</p>
                  </div>
                  <button
                    onClick={() => { setActiveTicket(existingOpenTicket); setView("chat"); }}
                    className="w-full py-3.5 bg-[#1A2B4C] text-white rounded-2xl font-bold text-sm"
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
                  {REASONS.map((reason) => (
                    <button
                      key={reason}
                      onClick={() => void createTicketFromReason(reason)}
                      disabled={sending}
                      className="w-full flex items-center justify-between p-4 bg-white border border-[#E5E2DC] rounded-2xl hover:border-[#1A2B4C] active:bg-[#1A2B4C]/5 transition text-left disabled:opacity-50"
                    >
                      <p className="font-semibold text-[#1A2B4C] text-sm">{reason}</p>
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

        {/* GENERAL FREE-TEXT VIEW — "Something else" path */}
        {view === "general" && (
          <div className="px-4 py-4 space-y-4">
            <div>
              <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-2">
                How can we help?
              </label>
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitGeneralTicket(); } }}
                placeholder="Describe your issue..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#1A2B4C] resize-none"
              />
            </div>
            <button onClick={() => void submitGeneralTicket()} disabled={!newMessage.trim() || sending}
              className="w-full py-3.5 bg-[#1A2B4C] text-white rounded-xl font-bold disabled:opacity-50">
              {sending ? "Sending..." : "Send message"}
            </button>
          </div>
        )}

        {/* CHAT VIEW */}
        {view === "chat" && activeTicket && (
          <div className="flex flex-col" style={{ height: "calc(100vh - 57px - 56px - env(safe-area-inset-bottom, 0px))" }}>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-2">
              {activeTicket.messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.sender === "customer" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                    msg.sender === "customer"
                      ? "bg-[#1A2B4C] text-white rounded-br-sm"
                      : msg.sender === "bot"
                      ? "bg-[#F5F5F5] text-[#595959] rounded-bl-sm"
                      : "bg-[#E68910]/10 text-[#1A2B4C] rounded-bl-sm"
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
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#1A2B4C]"
                />
                <button onClick={() => void addReplyToActive()} disabled={!newMessage.trim() || sending}
                  className="w-10 h-10 bg-[#1A2B4C] text-white rounded-xl flex items-center justify-center disabled:opacity-50">
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
