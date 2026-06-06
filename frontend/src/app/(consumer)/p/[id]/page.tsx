/** Short PDP alias — order summaries link to /p/:id. Forward to /product/:id. */
import { redirect } from "next/navigation";

export default async function PdpAlias(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  redirect(`/product/${id}`);
}
