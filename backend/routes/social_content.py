"""Social content agent — admin routes.

Mounted under /api/admin/social/* (same `/api` prefix every route in
server.py shares). Every route is gated with the SAME `require_admin`
dependency every other /admin/* endpoint uses — no separate auth mechanism
introduced here.

Kept as its own router/module, not folded into server.py, mirroring the
existing routes/addresses.py and routes/geo.py convention: server.py is
already flagged in docs/GO-LIVE-AUDIT.md as overdue for a split, so new
work goes in a new file rather than growing an 11k+ line one further.

Two route groups:
  - GET  /admin/social/opportunities/discounts
  - GET  /admin/social/opportunities/new-stores
        Read-only Business Intelligence Agent output (blueprint Part 4/5).
  - POST /admin/social/queue
  - GET  /admin/social/queue[?status=]
  - GET  /admin/social/queue/{id}
  - POST /admin/social/queue/{id}/approve|reject|request-changes
  - POST /admin/social/queue/{id}/notify
        The human-approval content queue (blueprint Part 6): create,
        list, and approve/reject/request-changes, plus a WhatsApp ping
        that reuses Lokl's existing notification layer instead of a new
        external tool (there's exactly one approver today).

No Instagram publish call lives here — see social_agent_service.py's
module docstring for why that's deliberately out of scope for now.
"""
import os
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from services import social_agent_service as svc


class QueueItemIn(BaseModel):
    pillar: str = "product"
    post_type: str = "post"
    source_event: Optional[str] = None
    data_source: Optional[str] = None
    caption: str = ""
    creative_brief: str = ""
    image_url: Optional[str] = None
    hashtags: list[str] = Field(default_factory=list)
    scheduled_time: Optional[str] = None
    notify: bool = True  # send the WhatsApp review ping immediately on create
    # Present when drafted FROM a live opportunity (not a manual post) — lets
    # create_queue_item consume that one opportunity so it stops showing in
    # the opportunities list, without touching any other still-open one.
    product_id: Optional[str] = None
    discount_percent: Optional[float] = None
    store_id: Optional[str] = None


class DismissDiscountIn(BaseModel):
    discount_percent: float


class ReviewIn(BaseModel):
    note: Optional[str] = None


def init(db, require_admin):
    # NOTE: "/api" must be baked in here explicitly — this router is mounted
    # directly on `app` (see server.py), not nested inside the `/api`-prefixed
    # `api` router everything else in server.py itself uses. Matches the same
    # convention routes/addresses.py and routes/geo.py already use
    # (APIRouter(prefix="/api/v1", ...)) — missing this was the cause of the
    # "Not Found" 404s on the very first deploy of this feature.
    router = APIRouter(prefix="/api/admin/social", tags=["social-agent"])

    async def _notify_admin(doc: dict):
        """WhatsApp ping via Lokl's existing notification layer — reuses
        `notifications.send_with_fallback`, the same helper every order
        update already goes through, instead of adding Slack/Notion for a
        single approver. Requires SOCIAL_AGENT_ADMIN_PHONE (a plain
        10-digit number — same normalization every other phone field in
        this codebase expects); silently skipped otherwise so a missing
        env var never blocks queue creation in dev/local."""
        phone = os.environ.get("SOCIAL_AGENT_ADMIN_PHONE", "").strip()
        if not phone:
            return
        from notifications import send_with_fallback
        admin_url = os.environ.get("ADMIN_APP_URL", "").rstrip("/")
        review_line = f"\nReview: {admin_url}/admin?tab=social&item={doc['id']}" if admin_url else ""
        body = (
            f"Lokl content ready to review: {doc.get('pillar')} / {doc.get('post_type')}\n"
            f"Reason: {doc.get('data_source') or doc.get('source_event') or 'manual'}\n"
            f"Caption: {(doc.get('caption') or '')[:200]}"
            f"{review_line}"
        )
        try:
            send_with_fallback(phone, body, message_type="social_content_review")
        except Exception:
            pass  # best-effort, same policy as every other notify_* call site

    @router.get("/opportunities/discounts")
    async def discount_opportunities(min_delta: int = 15, admin: dict = Depends(require_admin)):
        return await svc.get_discount_opportunities(db, min_discount_delta=min_delta)

    @router.post("/opportunities/discounts/{product_id}/dismiss")
    async def dismiss_discount(product_id: str, body: DismissDiscountIn, admin: dict = Depends(require_admin)):
        """Clears a discount opportunity WITHOUT drafting a post — e.g. you
        looked at it and decided it's not worth a post right now. Without
        this, the only way to make an opportunity stop showing would be to
        draft from it, which isn't always what you want."""
        await svc.mark_discount_consumed(db, product_id, body.discount_percent)
        return {"ok": True}

    @router.post("/opportunities/new-stores/{store_id}/dismiss")
    async def dismiss_new_store(store_id: str, admin: dict = Depends(require_admin)):
        await svc.mark_store_consumed(db, store_id)
        return {"ok": True}

    @router.get("/opportunities/new-stores")
    async def new_store_opportunities(admin: dict = Depends(require_admin)):
        return await svc.get_new_store_opportunities(db)

    @router.post("/queue")
    async def create_item(payload: QueueItemIn, admin: dict = Depends(require_admin)):
        doc = await svc.create_queue_item(db, payload.model_dump(exclude={"notify"}))
        if payload.notify:
            await _notify_admin(doc)
        return doc

    @router.get("/queue")
    async def list_items(status: Optional[str] = None, limit: int = 50, admin: dict = Depends(require_admin)):
        return await svc.list_queue_items(db, status=status, limit=limit)

    @router.get("/queue/{item_id}")
    async def get_item(item_id: str, admin: dict = Depends(require_admin)):
        doc = await svc.get_queue_item(db, item_id)
        if not doc:
            raise HTTPException(404, "Not found")
        return doc

    @router.post("/queue/{item_id}/approve")
    async def approve_item(item_id: str, body: ReviewIn = ReviewIn(), admin: dict = Depends(require_admin)):
        doc = await svc.update_queue_status(db, item_id, "approved", body.note)
        if not doc:
            raise HTTPException(404, "Not found")
        return doc

    @router.post("/queue/{item_id}/reject")
    async def reject_item(item_id: str, body: ReviewIn = ReviewIn(), admin: dict = Depends(require_admin)):
        doc = await svc.update_queue_status(db, item_id, "rejected", body.note)
        if not doc:
            raise HTTPException(404, "Not found")
        return doc

    @router.post("/queue/{item_id}/request-changes")
    async def request_changes(item_id: str, body: ReviewIn = ReviewIn(), admin: dict = Depends(require_admin)):
        doc = await svc.update_queue_status(db, item_id, "changes_requested", body.note)
        if not doc:
            raise HTTPException(404, "Not found")
        return doc

    @router.post("/queue/{item_id}/notify")
    async def notify_item(item_id: str, admin: dict = Depends(require_admin)):
        doc = await svc.get_queue_item(db, item_id)
        if not doc:
            raise HTTPException(404, "Not found")
        await _notify_admin(doc)
        return {"ok": True}

    return router


async def ensure_indexes(db):
    await svc.ensure_indexes(db)
