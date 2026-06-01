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
  radiusKm: number;
  permission: Permission;
  hasAsked: boolean;
}

interface LocationActions {
  setLocation: (lat: number, lng: number) => void;
  setCity: (slug: string, name: string) => void;
  setRadius: (km: number) => void;
  setPermission: (p: Permission) => void;
  requestLocation: () => Promise<void>;
}

type LocationStore = LocationState & LocationActions;

const INITIAL: LocationState = {
  lat: null,
  lng: null,
  citySlug: "bhilai",
  cityName: "Bhilai",
  radiusKm: 5,
  permission: "unknown",
  hasAsked: false,
};

export const useLocationStore = create<LocationStore>()(
  persist(
    (set) => ({
      ...INITIAL,

      setLocation: (lat, lng) => {
        set({ lat, lng });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(LOCATION_EVENT));
        }
      },

      setCity: (citySlug, cityName) => set({ citySlug, cityName }),
      setRadius: (radiusKm) => set({ radiusKm }),
      setPermission: (permission) => set({ permission }),

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
          set({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            permission: "granted",
          });
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event(LOCATION_EVENT));
          }
        } catch {
          set({ permission: "denied" });
        }
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
        radiusKm: state.radiusKm,
        hasAsked: state.hasAsked,
      }),
    },
  ),
);
