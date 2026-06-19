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
 * Domain routing: requests arriving on shoplokl.in / www.shoplokl.in are
 * rewritten to /coming-soon.html without a redirect. next.config.ts host-based
 * rewrites are unreliable in standalone mode; middleware runs at the edge and
 * is guaranteed to fire first.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const isShopLokl = host === 'shoplokl.in' || host === 'www.shoplokl.in'

  if (isShopLokl) {
    const url = request.nextUrl.clone()
    url.pathname = '/coming-soon.html'
    return NextResponse.rewrite(url)
  }

  // Redirect bare /orders/{id} links (e.g. from WhatsApp) to the auth-gated page.
  const { pathname } = request.nextUrl
  if (/^\/orders\/LOKL-[A-Z0-9]+$/.test(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `/account/orders/${pathname.split('/').pop()}`
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|coming-soon.html).*)',
  ],
}
