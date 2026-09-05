/**
 * Location store. PORTED key + event names from `lib/location.js`:
 *   • localStorage key:  `lokl_loc_v1`   (the legacy app's actual key)
 *   • cross-tab event:   `lokl:location`
 *
 * The legacy `in_service` flag (Bhilai polygon check) is intentionally NOT
 * implemented here — the polygon math + geo helpers will land in Session C
 * when the LocationGate / LocationBanner components are migrated. Today,
 * any granted location is considered serviceable.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const LOCATION_KEY = "lokl_loc_v1";
export const LOCATION_EVENT = "lokl:location";

type Permission = "granted" | "denied" | "prompt" | "unknown";

interface LocationState {
  lat: number | null;
  lng: number | null;
  citySlug: string;
  cityName: string;
  cluster: string | null;        // Iter-24 — Bhilai area/neighbourhood
  radiusKm: number;
  permission: Permission;
  hasAsked: boolean;
  /** Phase 10 — a guest/customer's manually-entered pincode, for when GPS
   *  isn't available/granted. Deliberately separate from lat/lng (never
   *  geocoded to coordinates here) — useLocationServiceability checks it
   *  directly via the SAME backend check-serviceability endpoint's
   *  existing pincode parameter, exactly mirroring how the saved-address
   *  fallback already works. Set alongside lat/lng being left null; a pin
   *  (lat/lng) still takes priority over this when both are present, same
   *  as the existing pin-over-saved-address priority. */
  pincode: string | null;
}

interface LocationActions {
  setLocation: (lat: number, lng: number) => void;
  setCity: (slug: string, name: string) => void;
  setCluster: (cluster: string | null) => void;
  setRadius: (km: number) => void;
  setPermission: (p: Permission) => void;
  requestLocation: () => Promise<void>;
  /** Iter-24 — if the browser already has geolocation permission granted,
   *  auto-fetch the position without prompting. No-op when permission is
   *  prompt/denied/unknown so first-time visitors still see the dialog. */
  autoDetectIfGranted: () => Promise<void>;
  /** Phase 10 — manual-pincode fallback for when GPS is unavailable/denied.
   *  Pass null to clear it (e.g. once a pin is later confirmed instead). */
  setPincode: (pincode: string | null) => void;
}

type LocationStore = LocationState & LocationActions;

const INITIAL: LocationState = {
  lat: null,
  lng: null,
  citySlug: "bhilai",
  cityName: "Bhilai",
  cluster: null,
  radiusKm: 5,
  permission: "unknown",
  hasAsked: false,
  pincode: null,
};

export const useLocationStore = create<LocationStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      setLocation: (lat, lng) => {
        set({ lat, lng, cluster: "Bhilai" });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(LOCATION_EVENT));
        }
      },

      setCity: (citySlug, cityName) => set({ citySlug, cityName }),
      setCluster: (cluster) => set({ cluster }),
      setRadius: (radiusKm) => set({ radiusKm }),
      setPermission: (permission) => set({ permission }),

      setPincode: (pincode) => {
        set({ pincode });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(LOCATION_EVENT));
        }
      },

      requestLocation: async () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          set({ permission: "denied", hasAsked: true });
          return;
        }
        set({ hasAsked: true });
        try {
          const position = await new Promise<GeolocationPosition>(
            (resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                timeout: 10_000,
                enableHighAccuracy: true,
              });
            },
          );
          set({ permission: "granted" });
          get().setLocation(position.coords.latitude, position.coords.longitude);
        } catch {
          set({ permission: "denied" });
        }
      },

      autoDetectIfGranted: async () => {
        // Iter-24 — silent auto-detect. We only proceed when the browser's
        // permission API says the user has ALREADY granted geolocation;
        // otherwise we leave the chip on the persisted city/cluster so
        // first-time visitors aren't surprise-prompted on page load.
        if (typeof navigator === "undefined" || !navigator.geolocation) return;
        try {
          // `permissions` isn't typed for the `geolocation` name in all
          // TS lib versions — guard with `any` rather than over-typing.
          const perms = (navigator as Navigator & { permissions?: { query: (q: { name: PermissionName }) => Promise<PermissionStatus> } }).permissions;
          if (!perms?.query) return;
          const status = await perms.query({ name: "geolocation" as PermissionName });
          if (status.state !== "granted") return;
          // Permission already granted — fetch without prompting.
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 8_000, enableHighAccuracy: true, maximumAge: 60_000,
            });
          });
          set({ permission: "granted" });
          get().setLocation(position.coords.latitude, position.coords.longitude);
        } catch { /* silent — user-permission flip races are fine */ }
      },
    }),
    {
      name: LOCATION_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        lat: state.lat,
        lng: state.lng,
        citySlug: state.citySlug,
        cityName: state.cityName,
        cluster: state.cluster,
        radiusKm: state.radiusKm,
        hasAsked: state.hasAsked,
        pincode: state.pincode,
      }),
    },
  ),
);
