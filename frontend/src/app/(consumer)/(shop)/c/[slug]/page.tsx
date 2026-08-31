import { Suspense } from "react";
import { CategoryRouteClient } from "@/components/consumer/CategoryRouteClient";

// Only Women/Men/Kids are active L1 slugs (Ethnic/Footwear/Lingerie/
// Accessories/Beauty/Sports deactivated — see migration
// 031_consolidate_l1_categories). This map is metadata-only (page <title>/
// description before the real category lookup runs) so a stale bookmark to
// an old slug just falls back to the slug's own title-cased text below,
// same as any other unrecognized slug — no need to keep dead entries.
const CATEGORY_NAMES: Record<string, string> = {
  "women": "Women's Fashion",
  "men":   "Men's Fashion",
  "kids":  "Kids",
};

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const name = CATEGORY_NAMES[slug] || slug
    .split("-")
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    title: `${name} in Bhilai — Shop Local | Lokl`,
    description: `Browse ${name} from trusted local stores in Bhilai. Order online, delivered in 45 minutes. Pay at delivery.`,
    openGraph: {
      title: `${name} in Bhilai | Lokl`,
      description: `Shop ${name} from Bhilai's best local stores. Fast delivery, real prices.`,
    },
  };
}

export default function CategoryL1Page() {
  return (
    <Suspense fallback={null}>
      <CategoryRouteClient />
    </Suspense>
  );
}
