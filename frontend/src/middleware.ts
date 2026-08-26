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
 * rewritten to /coming-soon (a real Next.js route, G15) without a redirect.
 * next.config.ts host-based rewrites are unreliable in standalone mode;
 * middleware runs at the edge and is guaranteed to fire first.
 *
 * G15 — this used to rewrite to the static /coming-soon.html file (still
 * present on disk, now unreferenced) with zero connection to the real
 * component/design system. /coming-soon is a real page built from
 * production components/tokens instead — see its own directory for detail.
 *
 * merchant.shoplokl.in is the merchant portal subdomain — bare root rewrites
 * to /merchant/register (same onboarding-with-login-option page as
 * lokl.up.railway.app/merchant/register), everything else under it passes
 * through untouched so /merchant/* and its assets work normally. Checked
 * BEFORE the shoplokl.in coming-soon check so the subdomain can never fall
 * into that branch (host equality below is exact, so this ordering is
 * belt-and-braces, not strictly load-bearing).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const { pathname } = request.nextUrl

  if (host === 'merchant.shoplokl.in') {
    if (pathname === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/merchant/register'
      return NextResponse.rewrite(url)
    }
    return NextResponse.next()
  }

  const isShopLokl = host === 'shoplokl.in' || host === 'www.shoplokl.in'

  // /api/* must fall through to the next.config.ts backend proxy rewrite,
  // never to the coming-soon page — otherwise POSTs made BY that very page
  // (e.g. the waitlist form's relative fetch('/api/waitlist')) inherit the
  // same Host header and get hijacked into a 405 against the static HTML,
  // silently dropping every submission before it reaches the backend.
  if (isShopLokl && !pathname.startsWith('/api')) {
    const url = request.nextUrl.clone()
    url.pathname = '/coming-soon'
    return NextResponse.rewrite(url)
  }

  // Redirect bare /orders/{id} links (e.g. from WhatsApp) to the auth-gated page.
  if (/^\/orders\/LOKL-[A-Z0-9]+$/.test(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `/account/orders/${pathname.split('/').pop()}`
    return NextResponse.redirect(url)
  }

  // /cart and /checkout were merged into one Bag/Checkout screen at
  // /checkout — /cart no longer has its own page.tsx, this redirect is the
  // only thing keeping the old URL alive (bookmarks, any external links).
  if (pathname === '/cart' || pathname.startsWith('/cart/')) {
    const url = request.nextUrl.clone()
    url.pathname = '/checkout'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|coming-soon.html).*)',
  ],
}
