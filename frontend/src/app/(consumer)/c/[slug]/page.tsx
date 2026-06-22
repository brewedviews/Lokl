import { CategoryClient } from "@/components/consumer/CategoryClient";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const name = slug
    .split("-")
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    title: `${name} in Bhilai — Shop Local | Lokl`,
    description: `Browse ${name} from trusted local stores in Bhilai. Order online, delivered in 30 minutes. Pay at delivery.`,
    openGraph: {
      title: `${name} — Local Stores in Bhilai | Lokl`,
      description: `Shop ${name} from Bhilai's best local stores. Fast delivery, real prices.`,
    },
  };
}

export default function CategoryL1Page() {
  return <CategoryClient />;
}
