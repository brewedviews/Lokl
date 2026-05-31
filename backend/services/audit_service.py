"""Append-only payment audit log. Never raises — audit failure must not break payments."""
from datetime import datetime, timezone
from typing import Optional


class AuditService:
    def __init__(self, db):
        self.db = db

    async def log(self, event_type: str, order_id: Optional[str] = None,
                  razorpay_order_id: Optional[str] = None,
                  razorpay_payment_id: Optional[str] = None,
                  amount: Optional[float] = None, actor: str = "system",
                  ip_address: Optional[str] = None, metadata: Optional[dict] = None):
        try:
            await self.db.payment_audit_log.insert_one({
                "event_type": event_type, "order_id": order_id,
                "razorpay_order_id": razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "amount": amount, "currency": "INR", "actor": actor,
                "ip_address": ip_address, "metadata": metadata or {},
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as e:
            print(f"[AUDIT] log write failed: {e}")
