/**
 * Phase 10 — LocationRequiredState: the "Allow location or enter pincode"
 * screen. Both paths must trigger a REAL check (via the mocked
 * useLocationStore actions / useLocationServiceability), never a client-
 * only decision of their own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationRequiredState } from "./LocationRequiredState";
import type { LocationServiceabilityResult } from "@/hooks/useLocationServiceability";

const requestLocation = vi.fn(async () => {});
const setPincode = vi.fn();
let mockPermission: "granted" | "denied" | "prompt" | "unknown" = "unknown";

vi.mock("@/stores/location.store", () => ({
  useLocationStore: (selector: (s: { permission: string; requestLocation: () => Promise<void>; setPincode: (p: string | null) => void }) => unknown) =>
    selector({ permission: mockPermission, requestLocation, setPincode }),
}));

let mockResult: LocationServiceabilityResult = {
  status: "no-location", isUnserviceable: false, message: null, lat: null, lng: null, area: null, retry: vi.fn(),
};
vi.mock("@/hooks/useLocationServiceability", () => ({
  useLocationServiceability: () => mockResult,
}));

beforeEach(() => {
  mockPermission = "unknown";
  requestLocation.mockClear();
  setPincode.mockClear();
  mockResult = {
    status: "no-location", isUnserviceable: false, message: null, lat: null, lng: null, area: null, retry: vi.fn(),
  };
});

describe("LocationRequiredState", () => {
  it("shows the Allow-location CTA and explanatory copy when permission hasn't been denied", () => {
    render(<LocationRequiredState />);
    expect(screen.getByTestId("allow-location-cta")).toBeInTheDocument();
    expect(screen.getByText(/stores and products actually/i)).toBeInTheDocument();
  });

  it("tapping Allow location calls the real useLocationStore.requestLocation() — no client-only check", async () => {
    const user = userEvent.setup();
    render(<LocationRequiredState />);
    await user.click(screen.getByTestId("allow-location-cta"));
    expect(requestLocation).toHaveBeenCalledTimes(1);
  });

  it("when permission is already denied, the Allow-location button is hidden and a clear explanation is shown instead", () => {
    mockPermission = "denied";
    render(<LocationRequiredState />);
    expect(screen.queryByTestId("allow-location-cta")).not.toBeInTheDocument();
    expect(screen.getByTestId("location-denied-explainer")).toHaveTextContent(/turned off/i);
  });

  it("the pincode form is always available, denied or not", () => {
    render(<LocationRequiredState />);
    expect(screen.getByTestId("pincode-input")).toBeInTheDocument();
    mockPermission = "denied";
    render(<LocationRequiredState />);
    expect(screen.getAllByTestId("pincode-input").length).toBeGreaterThan(0);
  });

  it("an invalid pincode is rejected client-side without calling setPincode", async () => {
    const user = userEvent.setup();
    render(<LocationRequiredState />);
    await user.type(screen.getByTestId("pincode-input"), "123");
    await user.click(screen.getByTestId("pincode-submit"));
    expect(screen.getByTestId("pincode-error")).toHaveTextContent(/6-digit/i);
    expect(setPincode).not.toHaveBeenCalled();
  });

  it("a valid 6-digit pincode calls the real setPincode — the actual serviceability check happens elsewhere (useLocationServiceability)", async () => {
    const user = userEvent.setup();
    render(<LocationRequiredState />);
    await user.type(screen.getByTestId("pincode-input"), "490020");
    await user.click(screen.getByTestId("pincode-submit"));
    expect(setPincode).toHaveBeenCalledWith("490020");
  });

  it("status checking (a real request in flight) shows a loading state, not the form", () => {
    mockResult = { ...mockResult, status: "checking" };
    render(<LocationRequiredState />);
    expect(screen.getByTestId("location-required-checking")).toBeInTheDocument();
    expect(screen.queryByTestId("allow-location-cta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pincode-form")).not.toBeInTheDocument();
  });

  it("status error shows the message and a retry that calls the hook's retry()", async () => {
    const retry = vi.fn();
    mockResult = { ...mockResult, status: "error", message: "Couldn't reach the server." };
    mockResult.retry = retry;
    const user = userEvent.setup();
    render(<LocationRequiredState />);
    expect(screen.getByTestId("location-required-error")).toHaveTextContent("Couldn't reach the server.");
    await user.click(screen.getByTestId("location-required-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
