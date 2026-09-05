import { CategoryTileRow } from "@/components/consumer/CategoryTileRow";
import { ServiceabilityGate } from "@/components/consumer/ServiceabilityGate";

/**
 * Shop route group — wraps Home (page.tsx) and every /c/[slug] category
 * page. Deliberately its own nested layout rather than adding to the
 * broader (consumer)/layout.tsx (which wraps every consumer route:
 * cart, checkout, PDP, account, search, stores, ...) — the persistent L1
 * tile strip only belongs on category-browsing pages, not a transactional
 * flow or a single-product page. Route groups (the parens) don't add a
 * URL segment, so this changes nothing about the actual routes — / and
 * /c/[slug] resolve exactly as before.
 *
 * CategoryTileRow mounts here, ONCE — not per-page — so navigating
 * between Home and a category page, or between two different L1s, never
 * remounts it (no refetch, no flicker, no repositioning). It's fully
 * self-contained (own categories fetch, own active-L1 detection via
 * usePathname()) — see its own doc comment — specifically so it can sit
 * here, in a server component, with no props to wire up.
 *
 * ConsumerHeader (header + search) already persists across this same
 * navigation for the same reason — it's mounted once in the parent
 * (consumer)/layout.tsx, not per-page — this layout extends that same
 * "shared chrome doesn't remount" property to the tile strip specifically
 * for this route pair.
 *
 * Wrapped in a plain <div>, not a bare Fragment — (consumer)/layout.tsx's
 * own {children} slot is itself a flex-col container (`flex-1 flex
 * flex-col bottom-nav-safe`). A Fragment renders no DOM node of its own,
 * so CategoryTileRow's root (`max-w-7xl mx-auto ...`) would become a
 * DIRECT flex-item child of that flex-col — the exact same containment
 * bug fixed on CategoryClient.tsx last round: mx-auto overrides flexbox's
 * default align-items:stretch, so the item falls back to its own content
 * width (the tile row's full unscrolled size) instead of the container's,
 * silently dragging the page wide again.
 *
 * `flex-1` (no `flex flex-col`) is deliberate: this div still needs to
 * participate correctly as a flex-ITEM of the outer flex-col (grow to
 * fill available height, same as every other page root already does per
 * that layout's own doc comment) — but it must NOT itself become a flex
 * CONTAINER, or CategoryTileRow would just hit the identical mx-auto/
 * stretch bug one level deeper as a flex-item of THIS div instead. Left
 * at the default `display:block`, its own children (CategoryTileRow,
 * {children}) stack in plain block flow — no flex context, so mx-auto
 * centering anywhere inside (CategoryTileRow's own wrapper, or any
 * page's own max-w-7xl sections) works exactly as normal block-level
 * centering always does, no stretch conflict possible.
 */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1">
      {/* Phase 9C — ServiceabilityGate wraps BOTH the tile strip and
          {children} (not just {children} alone): there's no point showing
          category navigation the customer can't actually shop from once
          we know their location is outside the delivery footprint. See
          ServiceabilityGate's own doc comment for why this is scoped to
          just Home + category pages, not the whole consumer layout. */}
      <ServiceabilityGate>
        <CategoryTileRow />
        {children}
      </ServiceabilityGate>
    </div>
  );
}
