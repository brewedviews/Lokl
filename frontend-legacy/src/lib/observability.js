// Sentry initialization with graceful degradation.
// When REACT_APP_SENTRY_DSN is unset/blank this module is a no-op so local
// builds continue to work without an external dependency.
import * as Sentry from "@sentry/react";

export function initSentry() {
  const dsn = (process.env.REACT_APP_SENTRY_DSN || "").trim();
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.info("[observability] Sentry disabled (REACT_APP_SENTRY_DSN not set).");
    return false;
  }

  const environment = process.env.REACT_APP_SENTRY_ENVIRONMENT || "development";
  const release = process.env.REACT_APP_SENTRY_RELEASE || undefined;
  const tracesSampleRate = Number(process.env.REACT_APP_SENTRY_TRACES_SAMPLE_RATE || "0.1");

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
    integrations: [Sentry.browserTracingIntegration()],
    initialScope: { tags: { service: "lokl-frontend" } },
  });
  // eslint-disable-next-line no-console
  console.info(`[observability] Sentry initialized (env=${environment}).`);
  return true;
}
