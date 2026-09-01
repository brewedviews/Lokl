import type { Metadata } from "next";
import { MerchantAuthForm } from "@/components/merchant/MerchantAuthForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Lokl.shop merchant account.",
};

export default function MerchantLoginPage() { return <MerchantAuthForm mode="login" />; }
