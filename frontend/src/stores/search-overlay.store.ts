"use client";

/**
 * Tiny global state for the SearchOverlay open/close — separate Zustand store
 * so multiple components (header, bottom nav, any "search inside category"
 * trigger) can open the overlay without prop-drilling.
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
