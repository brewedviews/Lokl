"use client";

/**
 * Lazy Sentry boot — `@sentry/react` is loaded via a dynamic `import()`
 * inside a `useEffect`, so the SDK never enters the shared client chunk.
 * On Lokl's bundle that pulls ~40 KB off every route's first-load JS.
 *
 * Graceful no-op when NEXT_PUBLIC_SENTRY_DSN is unset.
 */
import { useEffect } from "react";

export function SentryBoot() {
  useEffect(() => {
    const dsn = (process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
    if (!dsn) return;
    void import("@sentry/react").then(({ init, browserTracingIntegration }) => {
      init({
        dsn,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
        release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
        integrations: [browserTracingIntegration()],
        initialScope: { tags: { service: "lokl-frontend-next" } },
      });
    });
  }, []);
  return null;
}
