import { Suspense } from "react";
import { CategoryRouteClient } from "@/components/consumer/CategoryRouteClient";

const CATEGORY_NAMES: Record<string, string> = {
  "women":       "Women's Fashion",
  "men":         "Men's Fashion",
  "ethnic":      "Ethnic Wear",
  "footwear":    "Footwear",
  "lingerie":    "Lingerie & Innerwear",
  "kids":        "Kids",
  "accessories": "Accessories",
  "beauty":      "Beauty",
  "sports":      "Sports",
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
