/**
 * Phase 10 — location.store.ts's additive pincode field/setter. Only the
 * new surface is tested here; existing lat/lng/permission/hasAsked
 * behavior is untouched and already exercised indirectly by every other
 * test file that mocks this store.
 *
 * This is the first test in the suite to exercise the REAL (unmocked)
 * zustand-persist store — every other file mocks "@/stores/location.store"
 * entirely. That store's persist config resolves the bare `localStorage`
 * global inside createJSONStorage(() => localStorage); a static top-level
 * `import` of the store would hoist BEFORE any polyfill this file sets up
 * (ES module imports always evaluate before the importing module's own
 * body, regardless of source order), capturing `undefined`. A dynamic
 * import inside beforeAll — after the polyfill is installed — avoids that.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { useLocationStore as UseLocationStoreType } from "./location.store";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

let useLocationStore: typeof UseLocationStoreType;

beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
  ({ useLocationStore } = await import("./location.store"));
});

beforeEach(() => {
  useLocationStore.setState({ pincode: null, lat: null, lng: null });
});

describe("location.store — pincode (Phase 10)", () => {
  it("defaults to null", () => {
    expect(useLocationStore.getState().pincode).toBeNull();
  });

  it("setPincode stores the value", () => {
    useLocationStore.getState().setPincode("490020");
    expect(useLocationStore.getState().pincode).toBe("490020");
  });

  it("setPincode(null) clears it", () => {
    useLocationStore.getState().setPincode("490020");
    useLocationStore.getState().setPincode(null);
    expect(useLocationStore.getState().pincode).toBeNull();
  });

  it("setting a pincode does not touch lat/lng", () => {
    useLocationStore.getState().setPincode("490020");
    expect(useLocationStore.getState().lat).toBeNull();
    expect(useLocationStore.getState().lng).toBeNull();
  });

  it("pincode is included in the persisted (partialize) fields", () => {
    const persistOptions = (
      useLocationStore as unknown as { persist: { getOptions: () => { partialize?: (s: unknown) => Record<string, unknown> } } }
    ).persist.getOptions();
    const state = useLocationStore.getState();
    const persisted = persistOptions.partialize ? persistOptions.partialize(state) : state;
    expect(persisted).toHaveProperty("pincode");
  });
});
