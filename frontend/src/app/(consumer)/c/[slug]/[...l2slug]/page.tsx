import { Suspense } from "react";
import { CategoryClient } from "@/components/consumer/CategoryClient";

/** /c/[slug]/[...l2slug] — L2 sub-route; CategoryClient reads slug + l2slug
 *  from useParams and pre-selects the L2 filter on load. */
export default function CategoryL2Page() {
  return (
    <Suspense fallback={null}>
      <CategoryClient />
    </Suspense>
  );
}
