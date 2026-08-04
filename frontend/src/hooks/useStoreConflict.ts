"use client";

import { useCallback, useState } from "react";
import { useCartStore } from "@/stores";
import type { CartConflict } from "@/types";

/**
 * Shared "one store per bag" conflict flow. `promptConflict` opens the
 * warn-and-clear dialog; `confirmClearAndAdd` clears the bag and runs the
 * caller's retry — so every add-to-bag call site (product card, PDP) shows
 * the same dialog and behaves identically on confirm.
 */
export function useStoreConflict() {
  const clearCart = useCartStore((s) => s.clearCart);
  const [conflict, setConflict] = useState<CartConflict | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);

  const promptConflict = useCallback((c: CartConflict, onConfirm: () => void) => {
    setConflict(c);
    setRetry(() => onConfirm);
  }, []);

  const confirmClearAndAdd = useCallback(() => {
    clearCart();
    retry?.();
    setConflict(null);
    setRetry(null);
  }, [clearCart, retry]);

  const dismiss = useCallback(() => {
    setConflict(null);
    setRetry(null);
  }, []);

  return { conflict, promptConflict, confirmClearAndAdd, dismiss };
}
