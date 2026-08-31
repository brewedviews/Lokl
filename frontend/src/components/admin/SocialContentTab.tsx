"use client";

/**
 * Admin "Social" tab — the human-approval half of the Lokl x Claude
 * social-agent blueprint (Part 6). Two panels:
 *
 *  1. Opportunities — read-only output of the Business Intelligence Agent
 *     (services/social_agent_service.py): products whose discount just
 *     grew, and stores that just went live. "Draft post" turns one into a
 *     queue item with a simple templated caption — this page does not
 *     call Claude/Canva itself; that drafting step happens interactively
 *     (see the blueprint's Part 4 Creative Agent) and can either overwrite
 *     this caption before approval, or the item can be created directly
 *     via POST /admin/social/queue with a Claude-drafted caption already
 *     attached.
 *  2. Queue — every drafted post pending review, approved, rejected, or
 *     sent back for changes. Approving here does NOT publish to
 *     Instagram — that's the Meta Graph API integration (blueprint Part 3),
 *     deliberately not wired up yet. Approval just marks a post ready to
 *     go out, posted manually for now.
 *
 * A WhatsApp ping (reusing Lokl's existing notification layer) fires
 * automatically when a queue item is created — see routes/social_content.py.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ImagePlus, Store, Percent, Check, X, MessageSquareWarning } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import type {
  SocialDiscountOpportunity, SocialNewStoreOpportunity, SocialQueueItem, SocialQueueStatus,
} from "@/lib/api/admin";

const STATUS_LABEL: Record<SocialQueueStatus, string> = {
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  published: "Published",
};
const STATUS_COLOR: Record<SocialQueueStatus, string> = {
  pending_review: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  changes_requested: "bg-orange-100 text-orange-700",
  published: "bg-[#0A1F5C]/10 text-[#0A1F5C]",
};

export function SocialContentTab() {
  const [discounts, setDiscounts] = useState<SocialDiscountOpportunity[]>([]);
  const [newStores, setNewStores] = useState<SocialNewStoreOpportunity[]>([]);
  const [queue, setQueue] = useState<SocialQueueItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<SocialQueueStatus | "all">("pending_review");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, s, q] = await Promise.all([
        api.admin.listDiscountOpportunities(),
        api.admin.listNewStoreOpportunities(),
        api.admin.listSocialQueue(statusFilter === "all" ? undefined : statusFilter),
      ]);
      setDiscounts(d);
      setNewStores(s);
      setQueue(q);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const draftFromDiscount = async (o: SocialDiscountOpportunity) => {
    setBusyKey(`d-${o.product_id}`);
    try {
      await api.admin.createSocialQueueItem({
        pillar: "offer",
        post_type: "post",
        source_event: "discount",
        data_source: `${o.product_name ?? o.product_id} now ${o.discount_percent}% off (was ${o.previous_discount_percent}%)`,
        caption: `${o.product_name ?? "This one"} just dropped to ₹${o.price} (from ₹${o.mrp}) — ${o.discount_percent}% off, 45-minute delivery in Bhilai. Grab it before it's gone.`,
        image_url: o.image,
        hashtags: ["#LoklBhilai", "#BhilaiFashion", "#ShopLocal"],
        // Consumes just this opportunity — see routes/social_content.py's
        // create_queue_item — so it drops off the list, but nothing else does.
        product_id: o.product_id,
        discount_percent: o.discount_percent,
      });
      toast.success("Added to review queue");
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  const dismissDiscount = async (o: SocialDiscountOpportunity) => {
    setBusyKey(`d-${o.product_id}`);
    try {
      await api.admin.dismissDiscountOpportunity(o.product_id, o.discount_percent);
      toast.success("Dismissed");
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  const draftFromStore = async (o: SocialNewStoreOpportunity) => {
    setBusyKey(`s-${o.store_id}`);
    try {
      await api.admin.createSocialQueueItem({
        pillar: "merchant_story",
        post_type: "carousel",
        source_event: "new_store",
        data_source: `${o.store_name ?? o.store_id} went live with ${o.product_count} products (${o.category ?? "fashion"})`,
        caption: `Say hello to ${o.store_name ?? "our newest store"} — now on Lokl with ${o.product_count} products, delivered to your door in Bhilai in 45 minutes.`,
        hashtags: ["#LoklBhilai", "#NewOnLokl", "#ShopLocal"],
        store_id: o.store_id,
      });
      toast.success("Added to review queue");
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  const dismissStore = async (o: SocialNewStoreOpportunity) => {
    setBusyKey(`s-${o.store_id}`);
    try {
      await api.admin.dismissNewStoreOpportunity(o.store_id);
      toast.success("Dismissed");
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  const review = async (item: SocialQueueItem, action: "approve" | "reject" | "request-changes") => {
    setBusyKey(`r-${item.id}`);
    try {
      if (action === "approve") await api.admin.approveSocialQueueItem(item.id);
      else if (action === "reject") await api.admin.rejectSocialQueueItem(item.id);
      else await api.admin.requestSocialQueueChanges(item.id);
      toast.success(action === "approve" ? "Approved — post manually to Instagram for now" : "Updated");
      void load();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div data-testid="social-content-panel" className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-[#0A1F5C]">Social content agent</h2>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0A1F5C] hover:underline">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Opportunities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
          <h3 className="font-semibold text-[#0A1F5C] text-sm mb-3 flex items-center gap-1.5"><Percent size={14} /> New discounts ({discounts.length})</h3>
          {loading ? (
            <p className="text-xs text-[#595959] py-6 text-center">Loading…</p>
          ) : discounts.length === 0 ? (
            <p className="text-xs text-[#595959] py-6 text-center">No new discount movement since the last check.</p>
          ) : (
            <ul className="space-y-2">
              {discounts.map((o) => (
                <li key={o.product_id} className="flex items-center justify-between gap-3 border-t border-[#E5E2DC] pt-2 first:border-t-0 first:pt-0">
                  <div className="text-xs text-[#0A1F5C]">
                    <div className="font-semibold">{o.product_name ?? o.product_id}</div>
                    <div className="text-[#595959]">₹{o.price} · {o.discount_percent}% off (was {o.previous_discount_percent}%)</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => void draftFromDiscount(o)} disabled={busyKey === `d-${o.product_id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#0A1F5C] px-3 py-1.5 rounded-lg hover:bg-[#0A1F5C]/90 disabled:opacity-50"
                    >
                      <ImagePlus size={12} /> Draft post
                    </button>
                    <button
                      onClick={() => void dismissDiscount(o)} disabled={busyKey === `d-${o.product_id}`}
                      title="Not worth a post right now"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#595959] bg-[#FDFBF7] border border-[#E5E2DC] px-2.5 py-1.5 rounded-lg hover:bg-[#E5E2DC]/40 disabled:opacity-50"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-[#E5E2DC] rounded-2xl p-4">
          <h3 className="font-semibold text-[#0A1F5C] text-sm mb-3 flex items-center gap-1.5"><Store size={14} /> New stores live ({newStores.length})</h3>
          {loading ? (
            <p className="text-xs text-[#595959] py-6 text-center">Loading…</p>
          ) : newStores.length === 0 ? (
            <p className="text-xs text-[#595959] py-6 text-center">No stores have gone live since the last check.</p>
          ) : (
            <ul className="space-y-2">
              {newStores.map((o) => (
                <li key={o.store_id} className="flex items-center justify-between gap-3 border-t border-[#E5E2DC] pt-2 first:border-t-0 first:pt-0">
                  <div className="text-xs text-[#0A1F5C]">
                    <div className="font-semibold">{o.store_name ?? o.store_id}</div>
                    <div className="text-[#595959]">{o.product_count} products · {o.category ?? "fashion"}{o.locality ? ` · ${o.locality}` : ""}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => void draftFromStore(o)} disabled={busyKey === `s-${o.store_id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#0A1F5C] px-3 py-1.5 rounded-lg hover:bg-[#0A1F5C]/90 disabled:opacity-50"
                    >
                      <ImagePlus size={12} /> Draft post
                    </button>
                    <button
                      onClick={() => void dismissStore(o)} disabled={busyKey === `s-${o.store_id}`}
                      title="Not worth a post right now"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#595959] bg-[#FDFBF7] border border-[#E5E2DC] px-2.5 py-1.5 rounded-lg hover:bg-[#E5E2DC]/40 disabled:opacity-50"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Queue */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[#0A1F5C] text-sm">Review queue</h3>
          <select
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SocialQueueStatus | "all")}
            className="text-xs border border-[#E5E2DC] rounded-lg px-2 py-1 outline-none focus:border-[#0A1F5C]"
          >
            <option value="pending_review">Pending review</option>
            <option value="changes_requested">Changes requested</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>

        {loading ? (
          <p className="text-xs text-[#595959] py-6 text-center">Loading…</p>
        ) : queue.length === 0 ? (
          <p className="text-xs text-[#595959] py-6 text-center bg-white border border-[#E5E2DC] rounded-2xl">Nothing here — draft a post from an opportunity above.</p>
        ) : (
          <div className="space-y-3">
            {queue.map((item) => (
              <div key={item.id} data-testid={`social-queue-item-${item.id}`} className="bg-white border border-[#E5E2DC] rounded-2xl p-4 flex flex-col sm:flex-row gap-4">
                {item.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt="" className="w-full sm:w-28 h-28 object-cover rounded-xl border border-[#E5E2DC] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_COLOR[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span className="text-[10px] uppercase font-bold text-[#595959] tracking-wide">{item.pillar} · {item.post_type}</span>
                  </div>
                  <p className="text-xs text-[#595959] mb-1">{item.data_source}</p>
                  <p className="text-sm text-[#0A1F5C]">{item.caption}</p>
                  {item.review_note && (
                    <p className="text-xs text-orange-700 mt-1 flex items-center gap-1"><MessageSquareWarning size={12} /> {item.review_note}</p>
                  )}
                </div>
                {item.status === "pending_review" || item.status === "changes_requested" ? (
                  <div className="flex sm:flex-col gap-2 shrink-0">
                    <button
                      onClick={() => void review(item, "approve")} disabled={busyKey === `r-${item.id}`}
                      data-testid={`social-approve-${item.id}`}
                      className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-white bg-green-600 px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      <Check size={12} /> Approve
                    </button>
                    <button
                      onClick={() => void review(item, "request-changes")} disabled={busyKey === `r-${item.id}`}
                      data-testid={`social-changes-${item.id}`}
                      className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 px-3 py-1.5 rounded-lg hover:bg-orange-100 disabled:opacity-50"
                    >
                      Changes
                    </button>
                    <button
                      onClick={() => void review(item, "reject")} disabled={busyKey === `r-${item.id}`}
                      data-testid={`social-reject-${item.id}`}
                      className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100 disabled:opacity-50"
                    >
                      <X size={12} /> Reject
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
