"use client";

/**
 * Top-level client-side providers. Sentry initialization moved out to
 * `components/SentryBoot.tsx` (lazy dynamic import) so the SDK never lands
 * in the shared chunk — ~40 KB shaved off every route's first-load JS.
 */
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SentryBoot } from "@/components/SentryBoot";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <SentryBoot />
    </QueryClientProvider>
  );
}
