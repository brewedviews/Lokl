/**
 * Phase 10 — middleware.ts's /admin host restriction. Constructs real
 * NextRequest objects (Next.js exports a genuine, Node-usable class, not
 * an edge-runtime-only stub) and invokes `middleware()` directly, reading
 * the `x-middleware-rewrite` response header — the same signal verified
 * against the live production domain during the cutover phase (`curl -H
 * "Host: www.shoplokl.in" ... | grep x-middleware-rewrite`).
 *
 * Also covers the pre-existing behaviors this change must not disturb:
 * merchant.shoplokl.in's bare-root rewrite, the /orders/LOKL-* redirect,
 * and the /cart redirect.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function req(host: string, path: string) {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host },
  });
}

describe("middleware — /admin host restriction (Phase 10)", () => {
  it("www.shoplokl.in/admin is rewritten to a nonexistent path (renders not-found)", () => {
    const res = middleware(req("www.shoplokl.in", "/admin"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__lokl-admin-unavailable");
  });

  it("shoplokl.in/admin (apex) is also rewritten, ready for whenever DNS resolves it", () => {
    const res = middleware(req("shoplokl.in", "/admin"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__lokl-admin-unavailable");
  });

  it("merchant.shoplokl.in/admin is rewritten too — the merchant subdomain must not expose admin either", () => {
    const res = middleware(req("merchant.shoplokl.in", "/admin"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__lokl-admin-unavailable");
  });

  it("www.shoplokl.in/admin/merchants/123 (a sub-path) is also blocked, not just the bare route", () => {
    const res = middleware(req("www.shoplokl.in", "/admin/merchants/123"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/__lokl-admin-unavailable");
  });

  it("lokl.up.railway.app/admin is NOT rewritten — admin remains available on the Railway hostname", () => {
    const res = middleware(req("lokl.up.railway.app", "/admin"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("does not redirect to the Railway URL — it's a rewrite (same-request), never a Location redirect", () => {
    const res = middleware(req("www.shoplokl.in", "/admin"));
    expect(res.status).not.toBe(301);
    expect(res.status).not.toBe(302);
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
    expect(res.headers.get("location")).toBeNull();
  });

  it("www.shoplokl.in on a normal marketplace path is unaffected", () => {
    const res = middleware(req("www.shoplokl.in", "/"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("middleware — unaffected pre-existing behavior", () => {
  it("merchant.shoplokl.in bare root still rewrites to /merchant/register", () => {
    const res = middleware(req("merchant.shoplokl.in", "/"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/merchant/register");
  });

  it("merchant.shoplokl.in/merchant/products (non-root, non-admin) passes through untouched", () => {
    const res = middleware(req("merchant.shoplokl.in", "/merchant/products"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });

  it("/orders/LOKL-XYZ redirects to the auth-gated account page", () => {
    const res = middleware(req("lokl.up.railway.app", "/orders/LOKL-ABC123"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/account/orders/LOKL-ABC123");
  });

  it("/cart redirects to /checkout", () => {
    const res = middleware(req("lokl.up.railway.app", "/cart"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/checkout");
  });
});
