"use client";

/**
 * Admin layout. Inline login gate matches the legacy `/admin/login` →
 * `/admin` pattern: unauthenticated users see a minimal credentials form;
 * authenticated users see whichever admin page they navigated to.
 *
 * Per Session A constraint: AdminPanel.jsx itself is NOT ported in this
 * session — it'll use the `lib/legacy-admin.ts` compat shim in a later sweep.
 */
import { useState } from "react";
import { Toaster, toast } from "sonner";
import { Button, Card, Input } from "@/components/ui";
import { useAdminAuthStore } from "@/stores";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const isAuthed = useAdminAuthStore((s) => s.isAuthenticated);
  const setAuth = useAdminAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.admin.login({ email, password });
      setAuth(r.token);
      toast.success("Signed in");
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally { setBusy(false); }
  };

  if (isAuthed) {
    return (<><Toaster position="top-center" richColors />{children}</>);
  }

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <Toaster position="top-center" richColors />
      <Card size="lg" className="w-full max-w-md">
        <h1 className="font-display text-2xl text-brand-primary tracking-tight">Admin sign in</h1>
        <p className="text-sm text-text-muted mt-1">Private console — Lokl internal use only.</p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4" data-testid="admin-login-form">
          <Input label="Email" type="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} data-testid="admin-email" />
          <Input label="Password" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} data-testid="admin-password" />
          <Button type="submit" className="w-full" isLoading={busy} data-testid="admin-submit">
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
