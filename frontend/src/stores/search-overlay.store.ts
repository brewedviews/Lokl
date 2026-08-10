"use client";

/**
 * Tiny global state for the mobile search top sheet's open/close (owned and
 * rendered by ConsumerHeader) — a separate Zustand store so any future
 * trigger (a banner CTA, an empty-state "search instead" link, ...) can open
 * it without prop-drilling through the header.
 */
import { create } from "zustand";

interface SearchOverlayState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useSearchOverlay = create<SearchOverlayState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
