import { CategoryClient } from "@/components/consumer/CategoryClient";

/** /c/[slug]/[...l2slug] — L2 sub-route; CategoryClient reads slug from useParams. */
export default function CategoryL2Page() {
  return <CategoryClient />;
}
