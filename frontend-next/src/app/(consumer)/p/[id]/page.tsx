import { redirect } from "next/navigation";

/** Legacy alias — preserves the /p/:id URL shape that WhatsApp links may
 *  still send customers to. Permanent redirect to the canonical /product/:id. */
export default async function LegacyProductAlias({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/product/${id}`);
}
