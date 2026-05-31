"use client";

/**
 * Top-level client-side providers. Wraps the app in:
 *   - React Query (single QueryClient instance per page-load)
 *   - Sentry init (lifted into a `useEffect` so the SSR pass doesn't trip on
 *     `window`; the legacy app initialized in `index.js` at module-eval time
 *     which doesn't translate to App Router because layout.tsx is a server
 *     component by default).
 */
import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";

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

  useEffect(() => {
    const dsn = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
    if (!dsn) {
      // Disabled by absence of DSN — matches legacy lib/observability.js no-op.
      return;
    }
    const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development";
    const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
    const tracesSampleRate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1");
    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
      integrations: [Sentry.browserTracingIntegration()],
      initialScope: { tags: { service: "lokl-frontend-next" } },
    });
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
