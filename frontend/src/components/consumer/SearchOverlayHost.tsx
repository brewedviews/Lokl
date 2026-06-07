"use client";

/**
 * Thin wrapper that wires the global `useSearchOverlay` store to the
 * `SearchOverlay` component. Keeping this client-only host means we don't
 * have to mark the layout file as client.
 */
import { SearchOverlay } from "./SearchOverlay";
import { useSearchOverlay } from "@/stores";

export function SearchOverlayHost() {
  const open = useSearchOverlay((s) => s.open);
  const hide = useSearchOverlay((s) => s.hide);
  return <SearchOverlay open={open} onClose={hide} />;
}
