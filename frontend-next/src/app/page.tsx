/* Smoke page — verifies @theme tokens, UI primitives, and Zustand stores
 * render correctly. Session C replaces this with the real home feed. */
"use client";

import { Button, Card, Badge, Input, ProductCardSkeleton, StoreCardSkeleton } from "@/components/ui";
import { useCartStore } from "@/stores";
import { formatPrice, formatDistance, formatRelativeTime } from "@/lib/utils";

export default function Home() {
  const itemCount = useCartStore((s) => s.getItemCount());

  return (
    <main className="min-h-screen bg-brand-bg p-6 sm:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="font-display text-3xl text-brand-primary tracking-tight">
            Lokl — Next.js scaffold (Session B)
          </h1>
          <p className="text-sm text-text-muted">
            UI primitives + Zustand stores smoke screen. Cart items in store: {itemCount}.
          </p>
        </header>

        <Card size="lg">
          <h2 className="font-display text-xl text-brand-primary mb-4">Buttons</h2>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button isLoading>Loading</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
        </Card>

        <Card size="lg">
          <h2 className="font-display text-xl text-brand-primary mb-4">Badges</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="accent">New</Badge>
            <Badge variant="primary">Trusted</Badge>
            <Badge variant="muted">Paused</Badge>
            <Badge variant="success">Delivered</Badge>
            <Badge variant="error">Cancelled</Badge>
          </div>
        </Card>

        <Card size="lg">
          <h2 className="font-display text-xl text-brand-primary mb-4">Inputs</h2>
          <div className="space-y-4">
            <Input label="Mobile number" placeholder="10-digit mobile" />
            <Input label="OTP" placeholder="••••••" error="Incorrect OTP" />
            <Input label="Pincode" placeholder="490020" hint="Bhilai pincodes only." />
          </div>
        </Card>

        <Card size="lg">
          <h2 className="font-display text-xl text-brand-primary mb-4">Skeletons</h2>
          <div className="grid grid-cols-2 gap-4">
            <ProductCardSkeleton />
            <ProductCardSkeleton />
          </div>
          <div className="mt-4">
            <StoreCardSkeleton />
          </div>
        </Card>

        <Card size="lg">
          <h2 className="font-display text-xl text-brand-primary mb-4">Utils</h2>
          <ul className="text-sm space-y-2 text-text-muted">
            <li>formatPrice(1499) → <span className="text-brand-primary font-medium">{formatPrice(1499)}</span></li>
            <li>formatDistance(0.85) → <span className="text-brand-primary font-medium">{formatDistance(0.85)}</span></li>
            <li>formatDistance(3.2) → <span className="text-brand-primary font-medium">{formatDistance(3.2)}</span></li>
            <li>formatRelativeTime(now-3600s) → <span className="text-brand-primary font-medium">{formatRelativeTime(new Date(Date.now() - 3_600_000).toISOString())}</span></li>
          </ul>
        </Card>
      </div>
    </main>
  );
}
