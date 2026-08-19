"""Generic field-level encryption at rest, backed by cryptography.fernet.

Fernet is authenticated symmetric encryption (AES-128-CBC + HMAC) — a single
key encrypts and decrypts. Deliberately generic (encrypt_field/decrypt_field
on plain strings), not VasyERP-specific: first consumer is
MerchantIntegration.api_token, but the plaintext bank-details fields
(bank_account_number, bank_ifsc, account_holder_name — see server.py) are a
known follow-up that will reuse this same module.

Key management: FIELD_ENCRYPTION_KEY must be a base64-encoded 32-byte key,
exactly the format Fernet.generate_key() produces. Generate one with:

    python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

and set it in backend/.env — see .env.example. Losing this key makes every
previously-encrypted value permanently unrecoverable; rotating it requires
decrypting every stored value with the old key and re-encrypting with the
new one (not implemented here — no rotation need yet with a single consumer).

Deliberately lazy, not import-time-fatal (unlike JWT_SECRET's strict
"raise on import" pattern in auth.py): this key is only required once a
feature that actually touches encrypted fields is exercised, and the app
overall must keep booting for every merchant who never connects a VasyERP
integration. A clear RuntimeError still fires the moment encrypt_field/
decrypt_field is actually called without a configured key, so misconfig is
never silently swallowed — it just doesn't block unrelated app startup.
"""
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = os.environ.get("FIELD_ENCRYPTION_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is not set. Generate one with "
            "`python3 -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"` "
            "and set it in backend/.env (see .env.example)."
        )
    try:
        return Fernet(key.encode())
    except Exception as e:
        raise RuntimeError(f"FIELD_ENCRYPTION_KEY is not a valid Fernet key: {e}")


def encrypt_field(plaintext: str) -> str:
    """Encrypt a plain string for storage. Returns an opaque token string —
    store it directly, no further encoding needed."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_field(token: str) -> str:
    """Decrypt a token previously returned by encrypt_field. Raises
    ValueError on a corrupted/tampered token or a key mismatch (e.g. the
    key was rotated without re-encrypting stored data) — callers should
    treat this as "credential unusable, merchant must reconnect", not
    retry blindly."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        raise ValueError("Could not decrypt value — token is corrupted or was encrypted with a different key")
