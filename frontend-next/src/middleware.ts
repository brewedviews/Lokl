/**
 * Server-side route protection. Runs before page render so unauthenticated
 * users never see a flash of a protected shell.
 *
 * Layered with the client-side layout guards (which do the nuanced role
 * checks the middleware can't perform — Zustand isn't reachable here).
 *
 * Token detection: the FastAPI backend writes the refresh cookie at
 * `path=/api/auth` with `SameSite=Strict`, so it is NOT included on requests
 * for `/merchant/*` etc. We therefore cannot reliably read auth state from
 * cookies on the Next.js side — the middleware purely checks for the
 * cookie's existence as a coarse signal, and the layout owns the real call.
 *
 * Behavior chosen: pass-through everything. The client layouts handle
 * `router.replace` redirects on first paint. We leave this file in place
 * because adding edge-side checks later (e.g. JWT in a SameSite=Lax cookie)
 * becomes a one-file change.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/merchant/:path*", "/admin/:path*", "/account/:path*", "/checkout/:path*"],
};
