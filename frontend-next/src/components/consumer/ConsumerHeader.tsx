"use client";

/**
 * ConsumerHeader — sticky glass header. Ported from legacy
 * `components/consumer/ConsumerHeader.jsx` with state sourced from Zustand
 * (useCartStore for the cart badge, useLocationStore for the city display)
 * instead of the legacy contexts. Visual parity preserved.
 *
 * NOTE: Search typeahead UI is intentionally simplified in Session C to keep
 * the layout scaffolding focused. Full typeahead dropdown lands in Session D
 * when the search page itself is migrated.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Search, ShoppingBag, Store as StoreIcon, User } from "lucide-react";
import { useCartStore, useLocationStore, useCustomerAuthStore } from "@/stores";
import { useHeartbeat } from "@/hooks/useHeartbeat";

export function ConsumerHeader() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const count = useCartStore((s) => s.getItemCount());
  const city = useLocationStore((s) => s.cityName);
  const customerPhone = useCustomerAuthStore((s) => s.phone);

  useHeartbeat(customerPhone ? "customer" : "guest", { phone: customerPhone });

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <header
      data-testid="consumer-header"
      className="sticky top-0 z-50 bf-glass border-b border-card-border"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center gap-3 md:gap-6">
        <Link href="/" data-testid="brand-logo" className="flex items-center shrink-0">
          <span className="font-display text-2xl md:text-3xl font-bold tracking-tight text-brand-primary">
            lokl<span className="text-brand-accent">.</span>
          </span>
        </Link>

        <div
          data-testid="city-display"
          className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-card-border text-sm"
        >
          <MapPin size={15} className="text-brand-accent" />
          <span className="font-medium">{city}</span>
        </div>

        <form onSubmit={submitSearch} className="flex-1 flex relative">
          <div className="flex w-full items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-white border border-card-border rounded-full focus-within:border-brand-primary transition">
            <Search size={16} className="text-text-secondary" />
            <input
              data-testid="search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search kurtas, sneakers, stores…"
              className="bg-transparent flex-1 outline-none text-sm min-w-0"
            />
          </div>
        </form>

        <Link
          href="/stores"
          data-testid="nav-stores"
          className="hidden md:flex items-center gap-1.5 text-sm font-medium hover:text-brand-accent transition"
        >
          <StoreIcon size={16} /> Stores
        </Link>
        <Link
          href="/merchant/login"
          data-testid="nav-merchant"
          className="hidden md:inline text-sm font-medium hover:text-brand-accent transition"
        >
          For Merchants
        </Link>
        <Link
          href="/account"
          data-testid="nav-account"
          aria-label="Account"
          className="hidden md:flex w-9 h-9 rounded-full bg-white border border-card-border items-center justify-center hover:border-brand-primary transition shrink-0"
        >
          <User size={16} />
        </Link>
        <Link
          href="/cart"
          data-testid="nav-cart"
          className="relative flex items-center gap-1 px-3 py-2 rounded-full bg-brand-primary text-white hover:bg-brand-primary/90 transition shrink-0"
        >
          <ShoppingBag size={16} />
          {count > 0 && <span className="text-xs font-semibold">{count}</span>}
        </Link>
      </div>
    </header>
  );
}
