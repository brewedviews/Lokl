"use client";

/**
 * Route-segment error boundary. App-Router convention — file lives next to
 * the layout it protects. We forward the exception to Sentry via a dynamic
 * `import()` so the SDK stays out of every route's first-load JS chunk, and
 * offer the user a 1-click retry via `reset`.
 */
import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void import("@sentry/react").then(({ captureException }) => {
      captureException(error);
    });
  }, [error]);

  return (
    <main className="min-h-screen bg-brand-bg flex flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="text-5xl" aria-hidden="true">⚠️</span>
      <h2 className="text-xl font-display text-brand-primary tracking-tight">Something went wrong</h2>
      <p className="text-text-muted text-sm">We hit a snag. Our team has been notified.</p>
      <Button variant="secondary" size="sm" onClick={reset} data-testid="error-retry">
        Try again
      </Button>
    </main>
  );
}
