import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-brand-bg flex flex-col items-center justify-center gap-6 p-8 text-center bottom-nav-safe">
      <span className="text-6xl" aria-hidden="true">🏪</span>
      <h1 className="text-2xl font-display text-brand-primary tracking-tight">Page not found</h1>
      <p className="text-text-muted text-sm max-w-xs">
        This page does not exist or has been moved.
      </p>
      <Link href="/" className="text-brand-accent underline text-sm font-medium" data-testid="back-home">
        Back to home
      </Link>
    </main>
  );
}
