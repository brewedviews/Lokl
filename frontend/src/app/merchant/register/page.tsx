import type { Metadata } from "next";
import { MerchantAuthForm } from "@/components/merchant/MerchantAuthForm";

export const metadata: Metadata = {
  title: "Open your store",
  description: "Bring your Bhilai store online — get discovered by nearby customers, take orders, and deliver in 45 minutes. Free to list, zero commission.",
};

export default function MerchantRegisterPage() { return <MerchantAuthForm mode="register" />; }
