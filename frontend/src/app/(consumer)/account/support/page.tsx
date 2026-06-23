"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { Send, ChevronLeft } from "lucide-react";

interface Message { sender: string; text: string; created_at: string; }
interface Ticket { id: string; order_id?: string; subject: string; status: string; messages: Message[]; created_at: string; }

export default function SupportPage() {
  const sp = useSearchParams();
  const prefillOrderId = sp.get("order_id") || "";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState(prefillOrderId);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<"list" | "new" | "chat">(prefillOrderId ? "new" : "list");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTickets();
    loadOrders();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTicket?.messages]);

  const loadTickets = () => {
    apiClient.get("/api/support/my-tickets")
      .then((r: any) => setTickets(r.data?.tickets || []))
      .catch(() => {});
  };

  const loadOrders = () => {
    apiClient.get("/api/orders?limit=10")
      .then((r: any) => setOrders(r.data?.orders || r.data || []))
      .catch(() => {});
  };

  const submitTicket = async () => {
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      const r = await apiClient.post<Ticket>("/api/support/ticket", {
        order_id: selectedOrder || undefined,
        subject: selectedOrder
          ? `Issue with order #${selectedOrder.slice(-6).toUpperCase()}`
          : "General query",
        message: newMessage.trim(),
      });
      const ticket = r.data;
      setTickets((prev) => [ticket, ...prev]);
      setActiveTicket(ticket);
      setView("chat");
      setNewMessage("");
    } catch {
      toast.error("Could not send message. Try emailing support@shoplokl.in");
    } finally {
      setSending(false);
    }
  };

  const addReplyToActive = async () => {
    if (!activeTicket || !newMessage.trim()) return;
    setSending(true);
    try {
      await apiClient.post(`/api/support/ticket`, {
        order_id: activeTicket.order_id,
        subject: activeTicket.subject,
        message: newMessage.trim(),
      });
      const updated: Ticket = {
        ...activeTicket,
        messages: [
          ...activeTicket.messages,
          { sender: "customer", text: newMessage.trim(), created_at: new Date().toISOString() },
        ],
      };
      setActiveTicket(updated);
      setNewMessage("");
    } catch {
      toast.error("Could not send message.");
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    if (view === "chat" && activeTicket) {
      addReplyToActive();
    } else {
      submitTicket();
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7]">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E2DC] px-4 py-3 flex items-center gap-3 z-10">
          {view !== "list" ? (
            <button onClick={() => setView("list")} className="text-[#1A2B4C]">
              <ChevronLeft size={20} />
            </button>
          ) : (
            <Link href="/account" className="text-[#1A2B4C]">
              <ChevronLeft size={20} />
            </Link>
          )}
          <h1 className="font-bold text-[#1A2B4C]">
            {view === "chat" ? activeTicket?.subject || "Support chat" : "Help & Support"}
          </h1>
          {view === "list" && (
            <button onClick={() => setView("new")}
              className="ml-auto text-sm font-semibold text-[#E68910]">
              New request
            </button>
          )}
        </div>

        {/* LIST VIEW */}
        {view === "list" && (
          <div className="px-4 py-4 space-y-3">
            {tickets.length === 0 ? (
              <div className="text-center py-12">
                <p className="font-semibold text-[#1A2B4C] mb-1">No support requests yet</p>
                <p className="text-sm text-[#9CA3AF] mb-4">We are here to help</p>
                <button onClick={() => setView("new")}
                  className="px-6 py-2.5 bg-[#1A2B4C] text-white rounded-xl text-sm font-semibold">
                  Raise a request
                </button>
              </div>
            ) : (
              tickets.map((t) => (
                <button key={t.id} onClick={() => { setActiveTicket(t); setView("chat"); }}
                  className="w-full text-left bg-white border border-[#E5E2DC] rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-[#1A2B4C] text-sm">{t.subject}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      t.status === "replied" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {t.status === "replied" ? "Replied" : "Pending"}
                    </span>
                  </div>
                  <p className="text-xs text-[#9CA3AF] mt-1">
                    {new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </p>
                </button>
              ))
            )}

            <div className="mt-6 p-4 bg-white border border-[#E5E2DC] rounded-2xl">
              <p className="font-semibold text-[#1A2B4C] text-sm mb-3">Other ways to reach us</p>
              <a href="mailto:support@shoplokl.in"
                className="flex items-center gap-2 text-sm text-[#595959]">
                <span className="w-8 h-8 bg-[#FDFBF7] rounded-full flex items-center justify-center text-xs font-bold text-[#1A2B4C]">@</span>
                support@shoplokl.in
              </a>
            </div>
          </div>
        )}

        {/* NEW TICKET VIEW */}
        {view === "new" && (
          <div className="px-4 py-4 space-y-4">
            <div>
              <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-2">
                Related order (optional)
              </label>
              <select value={selectedOrder} onChange={(e) => setSelectedOrder(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] bg-white text-sm outline-none focus:border-[#1A2B4C]">
                <option value="">Not related to an order</option>
                {orders.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    Order #{(o.id || "").slice(-6).toUpperCase()} — {(o.items?.[0]?.name || "").slice(0, 30)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-[#595959] uppercase tracking-wide block mb-2">
                How can we help?
              </label>
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Describe your issue..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#1A2B4C] resize-none"
              />
            </div>

            <button onClick={submitTicket} disabled={!newMessage.trim() || sending}
              className="w-full py-3.5 bg-[#1A2B4C] text-white rounded-xl font-bold disabled:opacity-50">
              {sending ? "Sending..." : "Send message"}
            </button>
          </div>
        )}

        {/* CHAT VIEW */}
        {view === "chat" && activeTicket && (
          <div className="flex flex-col" style={{ height: "calc(100vh - 57px)" }}>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {activeTicket.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.sender === "customer" ? "justify-end" : "justify-start"}`}>
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
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {activeTicket.status !== "closed" && (
              <div className="border-t border-[#E5E2DC] p-4 flex gap-2 bg-white">
                <input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#1A2B4C]"
                />
                <button onClick={handleSend} disabled={!newMessage.trim() || sending}
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
