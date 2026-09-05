/**
 * Phase 9C (review pass) — useLocationServiceability's status model and
 * area-label resolution.
 *
 * Status model covers the audit's edge cases: no location selected yet
 * ("no-location", preserves normal browsing — never a false negative), a
 * location-store pin resolving serviceable/unserviceable, a check still
 * in flight ("checking" — must not be read as serviceable), a backend/
 * network error against a REAL pin ("error" — distinct from "no-location",
 * must not silently pass as serviceable either), retry(), and the saved-
 * address fallback for a customer who has no location-store pin yet.
 *
 * Area-label tests cover the location-label bug fix: the saved-address
 * fallback reuses useServiceability()'s own `area` (zero extra cost), and
 * the pin path resolves a friendly name via the SAME cities/detect
 * endpoint LocationBanner.tsx already uses — only once a pin is confirmed
 * unserviceable, and useLocationStore's own cluster/cityName are never
 * read for this at all (that's the source of the pre-existing "always
 * shows Bhilai" bug this fix avoids).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useLocationServiceability } from "./useLocationServiceability";

const mockLocationState = {
  lat: null as number | null,
  lng: null as number | null,
  pincode: null as string | null,
};
vi.mock("@/stores/location.store", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useLocationStore: (selector: (s: typeof mockLocationState) => any) => selector(mockLocationState),
}));

let mockSavedAddress = { area: null as string | null, hasConfirmedAddress: false, serviceable: true };
vi.mock("@/hooks/useServiceability", () => ({
  useServiceability: () => mockSavedAddress,
}));

const checkServiceability = vi.fn();
vi.mock("@/lib/api/delivery", () => ({
  deliveryApi: { checkServiceability: (...args: unknown[]) => checkServiceability(...args) },
}));

const apiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: { get: (...args: unknown[]) => apiGet(...args) },
}));

beforeEach(() => {
  mockLocationState.lat = null;
  mockLocationState.lng = null;
  mockLocationState.pincode = null;
  mockSavedAddress = { area: null, hasConfirmedAddress: false, serviceable: true };
  checkServiceability.mockReset();
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: { city_name: "Bengaluru" } });
});

describe("useLocationServiceability — status model", () => {
  it("edge case 1 — no location selected, no saved address: no-location, never serviceable or unserviceable", () => {
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("no-location");
    expect(result.current.isUnserviceable).toBe(false);
  });

  it("a pin resolving serviceable=true → status serviceable", async () => {
    mockLocationState.lat = 21.19;
    mockLocationState.lng = 81.33;
    checkServiceability.mockResolvedValue({ serviceable: true, message: "We deliver here!", zone: "Bhilai" });
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("serviceable"));
    expect(result.current.isUnserviceable).toBe(false);
    expect(checkServiceability).toHaveBeenCalledWith({ lat: 21.19, lng: 81.33 });
  });

  it("edge case 7 — coordinates outside the polygon → status unserviceable", async () => {
    mockLocationState.lat = 12.9716;
    mockLocationState.lng = 77.5946;
    checkServiceability.mockResolvedValue({ serviceable: false, message: "Sorry, we don't deliver here yet.", zone: null });
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("unserviceable"));
    expect(result.current.isUnserviceable).toBe(true);
    expect(result.current.message).toBe("Sorry, we don't deliver here yet.");
  });

  it("a pin present, check still in flight → status checking (must not read as serviceable)", () => {
    mockLocationState.lat = 21.19;
    mockLocationState.lng = 81.33;
    checkServiceability.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("checking");
    expect(result.current.isUnserviceable).toBe(false);
  });

  it("a pin present, the check request itself fails → status error, distinct from no-location, never serviceable", async () => {
    mockLocationState.lat = 21.19;
    mockLocationState.lng = 81.33;
    checkServiceability.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.isUnserviceable).toBe(false);
    expect(result.current.status).not.toBe("no-location");
    expect(result.current.status).not.toBe("serviceable");
  });

  it("retry() re-runs the same check after an error", async () => {
    mockLocationState.lat = 21.19;
    mockLocationState.lng = 81.33;
    checkServiceability.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("error"));

    checkServiceability.mockResolvedValueOnce({ serviceable: true, message: "ok", zone: "Bhilai" });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("serviceable"));
    expect(checkServiceability).toHaveBeenCalledTimes(2);
  });

  it("edge case 3 — no pin, but a confirmed saved address is unserviceable → falls back correctly", () => {
    mockSavedAddress = { area: "Somewhere Else", hasConfirmedAddress: true, serviceable: false };
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("unserviceable");
    expect(result.current.isUnserviceable).toBe(true);
  });

  it("edge case 2 — no pin, confirmed saved address is serviceable → serviceable", () => {
    mockSavedAddress = { area: "Sector 6", hasConfirmedAddress: true, serviceable: true };
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("serviceable");
    expect(result.current.isUnserviceable).toBe(false);
  });

  it("edge case 6 — guest with no saved address and no pin → no-location, never unserviceable", () => {
    mockSavedAddress = { area: null, hasConfirmedAddress: false, serviceable: true };
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("no-location");
    expect(result.current.isUnserviceable).toBe(false);
  });

  it("a pin always takes priority over the saved-address fallback, even mid-check (no flicker)", () => {
    mockLocationState.lat = 21.19;
    mockLocationState.lng = 81.33;
    checkServiceability.mockReturnValue(new Promise(() => {}));
    mockSavedAddress = { area: "Somewhere Else", hasConfirmedAddress: true, serviceable: false };
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("checking");
    expect(result.current.isUnserviceable).toBe(false);
  });
});

describe("useLocationServiceability — area label resolution", () => {
  it("no pin, saved-address fallback → reuses useServiceability()'s own area, no extra network call", () => {
    mockSavedAddress = { area: "Sector 6", hasConfirmedAddress: true, serviceable: false };
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.area).toBe("Sector 6");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("a pin resolves unserviceable → resolves a friendly name via cities/detect", async () => {
    mockLocationState.lat = 12.9716;
    mockLocationState.lng = 77.5946;
    checkServiceability.mockResolvedValue({ serviceable: false, message: "nope", zone: null });
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("unserviceable"));
    await waitFor(() => expect(result.current.area).toBe("Bengaluru"));
    expect(apiGet).toHaveBeenCalledWith(
      "/api/v1/cities/detect",
      expect.objectContaining({ params: { lat: 12.9716, lng: 77.5946 } }),
    );
  });

  it("a serviceable pin never triggers the cities/detect lookup (no point naming it)", async () => {
    mockLocationState.lat = 21.19;
    mockLocationState.lng = 81.33;
    checkServiceability.mockResolvedValue({ serviceable: true, message: "ok", zone: "Bhilai" });
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("serviceable"));
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.area).toBeNull();
  });

  it("cities/detect failing leaves area null rather than guessing — never falls back to useLocationStore's cluster/cityName", async () => {
    mockLocationState.lat = 12.9716;
    mockLocationState.lng = 77.5946;
    checkServiceability.mockResolvedValue({ serviceable: false, message: "nope", zone: null });
    apiGet.mockRejectedValue(new Error("geocode down"));
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("unserviceable"));
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(result.current.area).toBeNull();
  });
});

describe("useLocationServiceability — manual pincode tier (Phase 10)", () => {
  it("no pin, no saved address, a pincode is entered → checks it via the SAME backend endpoint (no second serviceability algorithm)", async () => {
    mockLocationState.pincode = "490020";
    checkServiceability.mockResolvedValue({ serviceable: true, message: "We deliver here!", zone: "Bhilai" });
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("serviceable"));
    expect(checkServiceability).toHaveBeenCalledWith({ pincode: "490020" });
  });

  it("an unserviceable pincode → status unserviceable, area is the pincode itself", async () => {
    mockLocationState.pincode = "560001";
    checkServiceability.mockResolvedValue({ serviceable: false, message: "Sorry, we don't deliver here yet.", zone: null });
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("unserviceable"));
    expect(result.current.isUnserviceable).toBe(true);
    expect(result.current.area).toBe("560001");
  });

  it("a pincode check in flight → status checking, never a false serviceable", () => {
    mockLocationState.pincode = "490020";
    checkServiceability.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("checking");
    expect(result.current.isUnserviceable).toBe(false);
  });

  it("the pincode request itself failing → status error, never no-location or serviceable", async () => {
    mockLocationState.pincode = "490020";
    checkServiceability.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.status).not.toBe("no-location");
    expect(result.current.status).not.toBe("serviceable");
  });

  it("retry() re-runs the pincode check after an error", async () => {
    mockLocationState.pincode = "490020";
    checkServiceability.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useLocationServiceability());
    await waitFor(() => expect(result.current.status).toBe("error"));

    checkServiceability.mockResolvedValueOnce({ serviceable: true, message: "ok", zone: "Bhilai" });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("serviceable"));
    expect(checkServiceability).toHaveBeenCalledTimes(2);
  });

  it("priority — a pin always wins over a stored pincode, even mid-check", () => {
    mockLocationState.lat = 21.19;
    mockLocationState.lng = 81.33;
    mockLocationState.pincode = "560001"; // a different, unserviceable pincode — must be ignored
    checkServiceability.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("checking");
    // Only the pin check should have been attempted, never the pincode one.
    expect(checkServiceability).toHaveBeenCalledWith({ lat: 21.19, lng: 81.33 });
    expect(checkServiceability).not.toHaveBeenCalledWith({ pincode: "560001" });
  });

  it("priority — a confirmed saved address always wins over a stored pincode", () => {
    mockSavedAddress = { area: "Sector 6", hasConfirmedAddress: true, serviceable: true };
    mockLocationState.pincode = "560001";
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("serviceable");
    expect(result.current.area).toBe("Sector 6");
    expect(checkServiceability).not.toHaveBeenCalled();
  });

  it("no pin, no saved address, no pincode → still no-location (unchanged baseline)", () => {
    const { result } = renderHook(() => useLocationServiceability());
    expect(result.current.status).toBe("no-location");
    expect(checkServiceability).not.toHaveBeenCalled();
  });
});
