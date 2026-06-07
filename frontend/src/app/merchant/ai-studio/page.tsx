"use client";

/**
 * AI Studio is temporarily disabled (iter-26 cleanup).
 * Keeps the file alive so old bookmarks / deep links don't 404 — just bounces
 * the user back to the dashboard. Backend AI endpoints are untouched and can
 * be re-enabled by restoring the original AI Studio UI when ready.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AiStudioRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/merchant/dashboard"); }, [router]);
  return null;
}
