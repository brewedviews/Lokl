"""Auth: JWT-based merchant auth (email/password)."""
import os
import jwt
import bcrypt
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv
from fastapi import HTTPException, Header, Depends
from typing import Optional

# Load .env early — server.py imports this module before its own load_dotenv()
load_dotenv(Path(__file__).parent / ".env")

# JWT_SECRET MUST come from the environment. No fallback. Enforce min length to
# prevent low-entropy keys (HS256 brute-force surface is non-trivial below 32B).
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if len(JWT_SECRET) < 32:
    raise ValueError("JWT_SECRET must be set in the environment and at least 32 characters long")
JWT_ALGO = "HS256"
# Access tokens expire fast (15 min). Long-lived sessions are obtained via the
# refresh-token rotation endpoint (/api/auth/refresh).
JWT_ACCESS_MIN = int(os.environ.get("JWT_ACCESS_MIN", "15"))
JWT_REFRESH_DAYS = int(os.environ.get("JWT_REFRESH_DAYS", "7"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, role: str = "merchant", token_type: str = "access") -> str:
    """Issue an access (short-lived) or refresh (long-lived) JWT.

    `token_type` is embedded in the payload so the /refresh endpoint can reject
    access tokens being replayed as refresh tokens and vice versa. Refresh
    tokens additionally carry a `jti` claim so they can be revoked on logout
    (see `revoked_refresh_jti` collection).

    Admin access tokens get an 8h TTL — admins work in the dashboard for hours
    and the short JWT_ACCESS_MIN we use for customers/merchants made the panel
    silently 401 mid-task (the visible 'Signature has expired' bug in iter-26)."""
    if token_type == "refresh":
        delta = timedelta(days=JWT_REFRESH_DAYS)
    elif role == "admin":
        delta = timedelta(hours=8)
    else:
        delta = timedelta(minutes=JWT_ACCESS_MIN)
    payload = {
        "sub": user_id,
        "role": role,
        "type": token_type,
        "exp": datetime.now(timezone.utc) + delta,
    }
    if token_type == "refresh":
        payload["jti"] = secrets.token_urlsafe(16)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    # Reject refresh tokens being used as access tokens
    if payload.get("type") == "refresh":
        raise HTTPException(status_code=401, detail="Refresh token cannot be used for API access")
    return payload


def require_role(*roles: str):
    """FastAPI dependency that enforces role-based access on a route.

    Usage:  user = Depends(require_role("merchant", "admin"))
    Returns 401 if the bearer token is missing/invalid; 403 if the user's role
    isn't in the allowlist."""
    async def _checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return _checker
