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
 * Domain routing (production cutover): shoplokl.in / www.shoplokl.in used to
 * be rewritten here to /coming-soon (G15). That rewrite is now REMOVED —
 * www.shoplokl.in is the real production domain for the actual Lokl
 * marketplace (verified already correctly pointed at this same Railway app,
 * on valid HTTPS), so requests on that host now fall through to normal
 * routing exactly like lokl.up.railway.app always has: real Home,
 * ServiceabilityGate, UnserviceableArea for a genuinely unserviceable
 * customer, etc. /coming-soon and its components have been deleted outright
 * (no other code depended on them — verified before removal). The bare apex
 * shoplokl.in (no www) is intentionally untouched here — it doesn't resolve
 * in DNS yet and adding an apex-specific redirect is out of scope for this
 * cutover.
 *
 * merchant.shoplokl.in is the merchant portal subdomain — bare root rewrites
 * to /merchant/register (same onboarding-with-login-option page as
 * lokl.up.railway.app/merchant/register), everything else under it passes
 * through untouched so /merchant/* and its assets work normally.
 *
 * /admin host restriction (Phase 10): the admin console must only be
 * reachable on the Railway hostname (lokl.up.railway.app), never on any
 * customer/merchant-facing custom domain. A request for /admin* on
 * shoplokl.in, www.shoplokl.in, or merchant.shoplokl.in is rewritten to a
 * guaranteed-nonexistent path so src/app/not-found.tsx renders exactly as
 * it already does for any genuinely missing route — the SAME technique
 * already used for the retired /coming-soon and /unserviceable routes.
 * Deliberately a rewrite, never a redirect to the Railway URL (that would
 * just relocate the exposure, not remove it) and never a substitute for
 * real authorization — the backend's `require_admin` JWT check is
 * completely untouched and remains the actual security boundary; this is
 * exposure reduction only, checked BEFORE the merchant.shoplokl.in
 * bare-root branch so /admin can never fall into that branch's default
 * pass-through.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const { pathname } = request.nextUrl

  const isPublicCustomDomain =
    host === 'shoplokl.in' || host === 'www.shoplokl.in' || host === 'merchant.shoplokl.in'
  if (isPublicCustomDomain && pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone()
    url.pathname = '/__lokl-admin-unavailable'
    return NextResponse.rewrite(url)
  }

  if (host === 'merchant.shoplokl.in') {
    if (pathname === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/merchant/register'
      return NextResponse.rewrite(url)
    }
    return NextResponse.next()
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
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
