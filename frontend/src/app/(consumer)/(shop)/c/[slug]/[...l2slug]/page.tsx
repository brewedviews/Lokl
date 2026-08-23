import { Suspense } from "react";
import { CategoryRouteClient } from "@/components/consumer/CategoryRouteClient";

/** /c/[slug]/[...l2slug] — L2 sub-route; L1PageClient's own BrowseGridBlock
 *  reads slug + l2slug from useParams and pre-selects the L2 filter on load. */
export default function CategoryL2Page() {
  return (
    <Suspense fallback={null}>
      <CategoryRouteClient />
    </Suspense>
  );
}
