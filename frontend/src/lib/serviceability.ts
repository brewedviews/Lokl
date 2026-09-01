/**
 * Single source of truth for "is this pincode serviceable" — pincode-based,
 * NOT GPS. Originally lived only inside checkout/page.tsx (its own local
 * const), which meant anything else that wanted the same check (the product
 * page's delivery/serviceability line) would have had to duplicate it and
 * risk drifting out of sync. Extracted here so checkout and the product
 * page share one list.
 *
 * Pilot is Bhilai-only; this mirrors the backend's own BHILAI_PINCODES
 * whitelist (server.py) at the app layer.
 */
export const BHILAI_PINCODES = ["490001", "490006", "490009", "490020", "490023", "490025", "490026"];

export function isServiceablePincode(pincode: string | null | undefined): boolean {
  const pin = (pincode ?? "").trim();
  if (pin.length !== 6) return false;
  return BHILAI_PINCODES.includes(pin);
}
