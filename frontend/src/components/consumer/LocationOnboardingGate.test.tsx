/**
 * Phase 10 — LocationOnboardingGate's phase state machine. Uses fake
 * timers to control the interstitial's minimum-duration hold
 * deterministically rather than waiting a real ~1s per test.
 *
 * FirstLoadInterstitial and LocationRequiredState are mocked to their own
 * testids — their own internals are covered by their own test files; this
 * file only has to prove the ORCHESTRATION (which phase renders when).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LocationOnboardingGate } from "./LocationOnboardingGate";
import type { LocationServiceabilityStatus } from "@/hooks/useLocationServiceability";

let mockStatus: LocationServiceabilityStatus = "no-location";
vi.mock("@/hooks/useLocationServiceability", () => ({
  useLocationServiceability: () => ({
    status: mockStatus,
    isUnserviceable: mockStatus === "unserviceable",
    message: null,
    lat: null,
    lng: null,
    area: null,
    retry: vi.fn(),
  }),
}));

vi.mock("./FirstLoadInterstitial", () => ({
  FirstLoadInterstitial: () => <div data-testid="stub-interstitial">interstitial</div>,
}));

vi.mock("./LocationRequiredState", () => ({
  LocationRequiredState: () => <div data-testid="stub-location-required">location required</div>,
}));

function Marketplace() {
  return <div data-testid="marketplace-content">shop</div>;
}

beforeEach(() => {
  mockStatus = "no-location";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LocationOnboardingGate", () => {
  it("first-time session (no-location): shows the interstitial immediately, not the marketplace", () => {
    render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    expect(screen.getByTestId("stub-interstitial")).toBeInTheDocument();
    expect(screen.queryByTestId("marketplace-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-location-required")).not.toBeInTheDocument();
  });

  it("holds the interstitial for the minimum duration, then reveals LocationRequiredState (still no-location)", () => {
    render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByTestId("stub-interstitial")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(50); // crosses the ~1000ms threshold
    });
    expect(screen.getByTestId("stub-location-required")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-interstitial")).not.toBeInTheDocument();
  });

  it("returning session (status already resolved) skips the interstitial hold and reveals the marketplace shell directly", () => {
    mockStatus = "serviceable";
    render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    // No artificial ~1s wait applied for a returning session — ready
    // immediately once the (synchronous) hydration effect has flushed.
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-interstitial")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-location-required")).not.toBeInTheDocument();
  });

  it("returning unserviceable session also skips onboarding — ServiceabilityGate (inside children) owns that decision", () => {
    mockStatus = "unserviceable";
    render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();
  });

  it("once GPS/pincode resolves serviceable while on LocationRequiredState, the gate reveals the shell", () => {
    const { rerender } = render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("stub-location-required")).toBeInTheDocument();

    mockStatus = "serviceable";
    rerender(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-location-required")).not.toBeInTheDocument();
  });

  it("once a pincode resolves unserviceable while on LocationRequiredState, the gate still reveals the shell (UnserviceableArea takes over via ServiceabilityGate)", () => {
    const { rerender } = render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    mockStatus = "unserviceable";
    rerender(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();
  });

  it("a check merely in flight (status checking) does NOT reveal the shell early — stays on LocationRequiredState", () => {
    const { rerender } = render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("stub-location-required")).toBeInTheDocument();

    mockStatus = "checking";
    rerender(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    expect(screen.getByTestId("stub-location-required")).toBeInTheDocument();
    expect(screen.queryByTestId("marketplace-content")).not.toBeInTheDocument();
  });

  it("a failed check (status error) does NOT reveal the shell early — stays on LocationRequiredState so its own error/retry UI can show", () => {
    const { rerender } = render(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    mockStatus = "error";
    rerender(
      <LocationOnboardingGate>
        <Marketplace />
      </LocationOnboardingGate>,
    );
    expect(screen.getByTestId("stub-location-required")).toBeInTheDocument();
    expect(screen.queryByTestId("marketplace-content")).not.toBeInTheDocument();
  });
});
