"use client";

/**
 * Returns `true` only after the component has mounted on the client.
 *
 * Use this to gate any UI whose initial render depends on values that are
 * only available client-side — most commonly `zustand/persist`-rehydrated
 * stores (cart, wishlist, location, customer-auth). Without this gate the
 * server renders the store's *initial* state (`count=0`, `city="Bhilai"`)
 * and the client renders the *rehydrated* state, which triggers React
 * hydration warning #418.
 *
 * Usage:
 *   const mounted = useMounted();
 *   ...
 *   {mounted && count > 0 && <Badge count={count} />}
 *
 * One hook, one extra `useState`/`useEffect` — keep it boring on purpose.
 */
import { useEffect, useState } from "react";

export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}
