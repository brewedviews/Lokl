"""Generate a VAPID key pair for rider web push (Group D1).

Run once (locally, not on Railway):

    cd backend && python3 scripts/generate_vapid_keys.py

Copy the printed values into Railway -> backend service -> Variables:
    VAPID_PUBLIC_KEY   (also needed by the rider PWA frontend, as
                        NEXT_PUBLIC_VAPID_PUBLIC_KEY, to call
                        pushManager.subscribe({applicationServerKey: ...}))
    VAPID_PRIVATE_KEY  (backend only — never expose this to the frontend)
    VAPID_SUBJECT       a mailto: address or the app's https URL, e.g.
                        mailto:hello@shoplokl.in — identifies you to push
                        services (Google/Mozilla) if they need to contact
                        you about your VAPID usage. Not secret.

Re-running this script generates a NEW, unrelated key pair — every rider's
existing push subscription is tied to the OLD public key and will silently
stop being deliverable if you swap keys without asking riders to
re-subscribe (the rider PWA's service worker calls pushManager.subscribe()
again on next load if there's no valid subscription — a future frontend
group's concern, not this one). Generate once, keep it stable.
"""
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02


def generate() -> tuple[str, str]:
    v = Vapid02()
    v.generate_keys()

    public_raw = v.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    public_b64 = base64.urlsafe_b64encode(public_raw).decode().rstrip("=")

    private_raw = v.private_key.private_numbers().private_value.to_bytes(32, "big")
    private_b64 = base64.urlsafe_b64encode(private_raw).decode().rstrip("=")

    return public_b64, private_b64


if __name__ == "__main__":
    pub, priv = generate()
    print("VAPID key pair generated. Set these in Railway (backend service):\n")
    print(f"VAPID_PUBLIC_KEY={pub}")
    print(f"VAPID_PRIVATE_KEY={priv}")
    print("VAPID_SUBJECT=mailto:hello@shoplokl.in")
    print("\n(VAPID_PUBLIC_KEY is also needed by the frontend as")
    print(" NEXT_PUBLIC_VAPID_PUBLIC_KEY — same value, safe to expose there.)")
