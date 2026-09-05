import type { Metadata } from "next";
import { UnserviceableArea } from "@/components/consumer/UnserviceableArea";

/**
 * /unserviceable — Phase 9C QA preview route.
 *
 * Renders the EXACT SAME UnserviceableArea component ServiceabilityGate
 * shows a genuinely unserviceable customer — not a second implementation.
 * Sits under the (consumer) route group (not (shop), which is where
 * ServiceabilityGate actually lives) so it inherits the real page shell —
 * ConsumerHeader, LocationBanner, StickyBottomNav — via
 * (consumer)/layout.tsx, without ever passing through ServiceabilityGate
 * itself: the real gate only wraps Home + category pages, and this route
 * must render the unserviceable state unconditionally, regardless of the
 * viewer's own actual location, so it's reachable and correct in every
 * environment without requiring anyone to first become unserviceable.
 *
 * Fixture data: representative "somewhere outside Bhilai" coordinates
 * (Bengaluru — the same fixture this feature's own test suite already
 * uses in useLocationServiceability.test.ts) and a neutral "your area"
 * label — never "Bhilai", matching the real component's own fallback for
 * an unresolved/no-name location (see UnserviceableArea.tsx's `displayLabel`).
 * Nothing here is written to useLocationStore, localStorage, or any
 * backend state merely by visiting this page — only the props passed to a
 * component that is otherwise 100% inert until a viewer explicitly
 * interacts with it (see below).
 *
 * `previewMode` is passed so "Request Lokl in your area" simulates its
 * success state without ever calling the real
 * api.site.joinWaitlist()/POST /api/waitlist — a QA visit (or repeated
 * clicks) can never create a real waitlist row. This is the ONLY behavior
 * difference from production; see UnserviceableArea.tsx's own doc comment
 * on that prop.
 *
 * LIMITATION (documented per this task's own instruction, not fixed):
 * "Change location" is the real, unmodified LocationChip — tapping it and
 * actually picking a saved address or using "Use current location" WILL
 * write to the viewer's real useLocationStore, exactly as it would for a
 * genuinely unserviceable customer, because this route renders the exact
 * same component rather than a second, inert picker (which the task
 * explicitly asks NOT to build). Simply loading /unserviceable never
 * triggers this — only an explicit tap inside that picker does.
 */
export const metadata: Metadata = {
  title: "Unserviceable Area Preview — Lokl",
  robots: { index: false, follow: false, nocache: true },
};

const PREVIEW_LAT = 12.9716;
const PREVIEW_LNG = 77.5946;

export default function UnserviceablePreviewPage() {
  return (
    <div className="flex-1 flex flex-col">
      <div
        data-testid="unserviceable-preview-banner"
        className="bg-brand-primary text-white text-center text-[11px] font-semibold uppercase tracking-wide px-4 py-1.5"
      >
        QA preview — not a real customer session. &quot;Request Lokl in your area&quot; will not submit a real request.
      </div>
      <UnserviceableArea lat={PREVIEW_LAT} lng={PREVIEW_LNG} area="your area" previewMode />
    </div>
  );
}
