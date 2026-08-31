"""Reset the LOCAL DEVELOPMENT admin login password.

Run interactively, from the backend directory, with the same interpreter
that runs the app (so bcrypt/pymongo/dotenv resolve):

    cd backend && python3 scripts/dev_reset_admin_password.py

What it does, in order:
  1. Prompts for a new password twice via getpass (hidden — never echoed
     to the terminal, never logged, never printed by this script).
  2. Hashes it with bcrypt (same hash_password() the app itself uses).
  3. Rewrites ONLY the ADMIN_PASSWORD_HASH= line in backend/.env in place
     — every other line/secret in .env is left untouched.
  4. Updates the matching admin_users Mongo record's password_hash field
     directly (does not delete/reseed — preserves id/created_at/etc.).
  5. Tells you to restart the backend so the new .env value is loaded
     (uvicorn --reload does NOT reload .env on file changes — only on
     source-file changes — so a process restart is required here).

Local development only. Does not touch auth logic, does not mint tokens,
does not weaken any check — it only rotates the one credential a human
is expected to know, exactly the way you'd do it by hand.

Contains no credentials of any kind — safe to keep in the repo.
"""
import getpass
import os
import re
import sys

import bcrypt
from pymongo import MongoClient

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BACKEND_DIR, ".env")


def load_env(path: str) -> dict:
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def main() -> int:
    env = load_env(ENV_PATH)
    admin_email = env.get("ADMIN_EMAIL", "").strip().lower()
    if not admin_email:
        print("ADMIN_EMAIL not found in .env — aborting.")
        return 1

    pw1 = getpass.getpass("New LOCAL admin password: ")
    if len(pw1) < 8:
        print("Password must be at least 8 characters — aborting.")
        return 1
    pw2 = getpass.getpass("Confirm new password: ")
    if pw1 != pw2:
        print("Passwords did not match — aborting. Nothing was changed.")
        return 1

    new_hash = bcrypt.hashpw(pw1.encode(), bcrypt.gensalt(rounds=12)).decode()
    del pw1, pw2  # never referenced again

    # ---- 1. Rewrite ADMIN_PASSWORD_HASH in .env, line-for-line ----
    with open(ENV_PATH) as f:
        lines = f.readlines()
    replaced = False
    for i, line in enumerate(lines):
        if re.match(r"^ADMIN_PASSWORD_HASH=", line):
            lines[i] = f"ADMIN_PASSWORD_HASH={new_hash}\n"
            replaced = True
            break
    if not replaced:
        lines.append(f"ADMIN_PASSWORD_HASH={new_hash}\n")
    with open(ENV_PATH, "w") as f:
        f.writelines(lines)
    print("[1/3] .env ADMIN_PASSWORD_HASH updated.")

    # ---- 2. Update the matching Mongo admin_users record in place ----
    client = MongoClient(env["MONGO_URL"])
    db = client[env.get("DB_NAME", "lokl_dev")]
    result = db.admin_users.update_one(
        {"email": admin_email},
        {"$set": {"password_hash": new_hash, "active": True}},
    )
    if result.matched_count == 0:
        print(f"[2/3] No admin_users record for {admin_email} — inserting a fresh one.")
        import uuid
        from datetime import datetime, timezone
        db.admin_users.insert_one({
            "id": f"adm-{uuid.uuid4().hex[:8]}",
            "email": admin_email,
            "password_hash": new_hash,
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": "dev-reset-script",
            "active": True,
        })
    else:
        print("[2/3] admin_users record updated in place.")

    print("[3/3] Done. Restart the backend process now (same command it "
          "already runs — e.g. uvicorn server:app --reload) so it picks up "
          "the new .env value, then log in at http://localhost:3000/admin.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
