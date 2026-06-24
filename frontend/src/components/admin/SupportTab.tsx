"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Send, X, RefreshCw } from "lucide-react";
import { adminFetch } from "@/lib/legacy-admin";

interface Message { sender: string; text: string; created_at: string; }
interface SupportTicket {
  id: string;
  customer_phone: string;
  order_id?: string;
  subject: string;
  status: string;
  created_at: string;
  messages: Message[];
}

type StatusFilter = "all" | "open" | "replied" | "closed";

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
      ? { label: "Replied", cls: "bg-[#0A1F5C]/10 text-[#0A1F5C]" }
      : { label: "Closed", cls: "bg-[#E5E2DC] text-[#595959]" };
  return (
    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

interface SupportTabProps {
  onOpenCountChange?: (count: number) => void;
}

export function SupportTab({ onOpenCountChange }: SupportTabProps) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const data = await adminFetch<{ tickets: SupportTicket[] }>("/api/admin/support/tickets");
      const list = data.tickets ?? [];
      setTickets(list);
      onOpenCountChange?.(list.filter((t) => t.status === "open").length);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [onOpenCountChange]);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected?.messages?.length]);

  const openTicket = async (t: SupportTicket) => {
    try {
      const full = await adminFetch<SupportTicket>(`/api/admin/support/tickets/${t.id}`);
      setSelected(full);
      setReply("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await adminFetch(`/api/admin/support/tickets/${selected.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ text: reply.trim() }),
      });
      toast.success("Reply sent");
      setReply("");
      const [full] = await Promise.all([
        adminFetch<SupportTicket>(`/api/admin/support/tickets/${selected.id}`),
        loadList(),
      ]);
      setSelected(full);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (newStatus: string) => {
    if (!selected) return;
    setStatusBusy(true);
    try {
      await adminFetch(`/api/admin/support/tickets/${selected.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(`Status set to ${newStatus}`);
      setSelected((s) => (s ? { ...s, status: newStatus } : s));
      void loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusy(false);
    }
  };

  const filtered = tickets.filter((t) => filter === "all" || t.status === filter);
  const openCount = tickets.filter((t) => t.status === "open").length;

  return (
    <div data-testid="support-panel" className="flex gap-6" style={{ height: "calc(100vh - 160px)", minHeight: 500 }}>

      {/* Ticket list */}
      <div className="flex flex-col w-80 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl font-bold text-[#0A1F5C]">
            Support{openCount > 0 && (
              <span className="ml-2 text-sm font-semibold text-[#E68910]">({openCount} open)</span>
            )}
          </h2>
          <button onClick={() => void loadList()}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0A1F5C] hover:underline">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>

        <div className="flex gap-1 mb-3 flex-wrap">
          {(["all", "open", "replied", "closed"] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-semibold capitalize border transition-colors ${
                filter === f
                  ? "bg-[#0A1F5C] text-white border-[#0A1F5C]"
                  : "bg-white text-[#595959] border-[#E5E2DC] hover:border-[#0A1F5C]"
              }`}>
              {f}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {filtered.length === 0 ? (
            <div className="text-sm text-[#595959] text-center py-10 bg-white border border-dashed border-[#E5E2DC] rounded-2xl">
              No tickets in this state.
            </div>
          ) : (
            filtered.map((t) => {
              const isActive = selected?.id === t.id;
              return (
                <button key={t.id} onClick={() => void openTicket(t)}
                  className={`w-full text-left rounded-2xl border p-3 transition-colors ${
                    isActive
                      ? "bg-[#0A1F5C] text-white border-[#0A1F5C]"
                      : t.status === "open"
                      ? "bg-white border-[#E68910]/40 hover:border-[#E68910]"
                      : "bg-white border-[#E5E2DC] hover:border-[#0A1F5C]/30"
                  }`}>
                  <div className="flex items-start justify-between gap-1">
                    <p className={`font-semibold text-xs leading-snug truncate ${isActive ? "text-white" : "text-[#0A1F5C]"}`}>
                      {t.subject}
                    </p>
                    {t.status === "open" && !isActive && (
                      <span className="w-2 h-2 bg-[#E68910] rounded-full flex-shrink-0 mt-0.5" />
                    )}
                  </div>
                  <p className={`font-mono text-[10px] mt-1 ${isActive ? "text-white/70" : "text-[#595959]"}`}>
                    {t.customer_phone}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    {!isActive && <StatusPill status={t.status} />}
                    <p className={`text-[10px] ml-auto ${isActive ? "text-white/60" : "text-[#9CA3AF]"}`}>
                      {toIST(t.created_at)}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Thread view */}
      <div className="flex-1 min-w-0 flex flex-col bg-white rounded-2xl border border-[#E5E2DC] overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#595959]">
            Select a ticket to view the conversation.
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#E5E2DC]">
              <div className="min-w-0">
                <p className="font-semibold text-[#0A1F5C] text-sm truncate">{selected.subject}</p>
                <p className="font-mono text-[11px] text-[#595959] mt-0.5">{selected.customer_phone}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusPill status={selected.status} />
                <select
                  value={selected.status}
                  onChange={(e) => void changeStatus(e.target.value)}
                  disabled={statusBusy}
                  className="px-2 py-1 rounded-lg border border-[#E5E2DC] text-xs outline-none focus:border-[#0A1F5C] disabled:opacity-50 bg-white"
                >
                  <option value="open">Set Open</option>
                  <option value="replied">Set Replied</option>
                  <option value="closed">Set Closed</option>
                </select>
                <button onClick={() => setSelected(null)}
                  className="w-7 h-7 rounded-full bg-[#FDFBF7] flex items-center justify-center hover:bg-[#E5E2DC]">
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#FDFBF7]">
              {selected.messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.sender === "admin" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                    msg.sender === "admin"
                      ? "bg-[#0A1F5C] text-white rounded-br-sm"
                      : msg.sender === "customer"
                      ? "bg-white border border-[#E5E2DC] text-[#1A2B4C] rounded-bl-sm"
                      : "bg-[#F5F5F5] text-[#595959] rounded-bl-sm"
                  }`}>
                    {msg.sender === "customer" && (
                      <p className="text-[10px] font-bold text-[#E68910] mb-1">Customer</p>
                    )}
                    {msg.sender === "bot" && (
                      <p className="text-[10px] font-bold text-[#9CA3AF] mb-1">Bot</p>
                    )}
                    <p>{msg.text}</p>
                  </div>
                  <p className="text-[10px] text-[#9CA3AF] mt-1 px-1">{toIST(msg.created_at)}</p>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply / closed footer */}
            {selected.status === "closed" ? (
              <div className="border-t border-[#E5E2DC] px-4 py-3 bg-white text-center">
                <p className="text-xs text-[#595959]">This ticket is closed.</p>
              </div>
            ) : (
              <div className="border-t border-[#E5E2DC] p-3 flex gap-2 bg-white">
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(); } }}
                  placeholder="Reply to customer..."
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E2DC] text-sm outline-none focus:border-[#0A1F5C]"
                />
                <button onClick={() => void sendReply()} disabled={!reply.trim() || sending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#0A1F5C] text-white rounded-xl text-sm font-semibold disabled:opacity-50 whitespace-nowrap">
                  <Send size={14} /> {sending ? "Sending..." : "Reply"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
