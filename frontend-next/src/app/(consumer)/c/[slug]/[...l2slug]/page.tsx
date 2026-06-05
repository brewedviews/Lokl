import { CategoryClient } from "@/components/consumer/CategoryClient";

/** /c/[slug]/[...l2slug] — sub-route catches the L2 segment. */
export default async function CategoryL2Page({
  params,
}: {
  params: Promise<{ l2slug: string[] }>;
}) {
  const { l2slug } = await params;
  const first = Array.isArray(l2slug) ? l2slug[0] : l2slug;
  return <CategoryClient l2slug={first} />;
}
