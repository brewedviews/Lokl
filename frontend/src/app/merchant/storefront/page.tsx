"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMerchantAuthStore } from "@/stores";
import { StorefrontForm, type StorefrontFormInitial, type StorefrontFormBody } from "@/components/storefront/StorefrontForm";

export default function MerchantStorefrontPage() {
  const router = useRouter();
  const merchant = useMerchantAuthStore((s) => s.user) as (typeof useMerchantAuthStore extends () => infer T ? T : never) | null;
  type Mer = { store_name?: string; business_address?: string; storefront?: StorefrontFormInitial };
  const m = (merchant ?? {}) as unknown as Mer;
  const [initialData, setInitialData] = useState<StorefrontFormInitial | null>(null);

  useEffect(() => {
    api.merchant.getStorefront().then((s) => {
      if (!s?.tagline) return;
      setInitialData(s as StorefrontFormInitial);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (m.storefront) setInitialData(m.storefront);
  }, [m.storefront]);

  const handleSubmit = async (body: StorefrontFormBody) => {
    await api.merchant.saveStorefront(body as unknown as Parameters<typeof api.merchant.saveStorefront>[0]);
    toast.success("Storefront saved");
    router.replace("/merchant/products");
  };

  return (
    <div className="p-4 md:p-10 pb-24 md:pb-10 max-w-3xl">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-[#1A2B4C] flex items-center gap-2"><Store size={26} /> Storefront</h1>
      <p className="text-[#595959] mt-1">Edit the public face of the store.</p>

      <div className="mt-6 bg-white border border-[#E5E2DC] rounded-3xl p-6">
        <StorefrontForm
          mode="edit"
          storeName={m.store_name || ""}
          businessAddress={m.business_address || ""}
          initialData={initialData}
          onSubmit={handleSubmit}
          submitLabel="Save & continue"
          callerScope="merchant"
        />
      </div>
    </div>
  );
}
