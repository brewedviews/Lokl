"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bike } from "lucide-react";
import { RiderOtpLogin } from "@/components/rider/RiderOtpLogin";
import { useRiderAuthStore } from "@/stores";

export default function RiderLoginPage() {
  const router = useRouter();
  const isAuthed = useRiderAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthed) router.replace("/rider");
  }, [isAuthed, router]);

  return (
    <div className="min-h-screen bg-brand-primary flex flex-col items-center justify-center px-5 py-10" data-testid="rider-login-page">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-white/10 grid place-items-center mx-auto mb-4">
            <Bike size={28} className="text-white" />
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Lokl Rider</h1>
          <p className="text-white/70 text-sm mt-1">Sign in to start delivering</p>
        </div>
        <RiderOtpLogin onSuccess={() => router.replace("/rider")} />
        <p className="text-center text-white/50 text-xs mt-6">
          Not registered yet? Ask your Lokl coordinator to set up your account.
        </p>
      </div>
    </div>
  );
}
