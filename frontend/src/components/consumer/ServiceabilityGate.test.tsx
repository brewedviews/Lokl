/**
 * Phase 9C (review pass) — ServiceabilityGate render-branch behavior.
 * Proves the swap itself across all five hook statuses: "no-location" and
 * "serviceable" render the marketplace children unchanged; "checking"
 * renders a loading state (never the marketplace); "error" renders a
 * retry state (never the marketplace, never UnserviceableArea); a
 * confirmed "unserviceable" renders UnserviceableArea, receiving the
 * hook's lat/lng/area. The serviceability DECISION is unit-tested
 * separately in useLocationServiceability.test.ts — this file mocks that
 * hook so it only has to prove the branch, not re-derive the decision.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceabilityGate } from "./ServiceabilityGate";
import type { LocationServiceabilityResult } from "@/hooks/useLocationServiceability";

const retry = vi.fn();
let mockResult: LocationServiceabilityResult = {
  status: "no-location", isUnserviceable: false, message: null, lat: null, lng: null, area: null, retry,
};
vi.mock("@/hooks/useLocationServiceability", () => ({
  useLocationServiceability: () => mockResult,
}));

vi.mock("./UnserviceableArea", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  UnserviceableArea: (props: any) => (
    <div data-testid="unserviceable-area-stub" data-lat={props.lat} data-lng={props.lng} data-area={props.area}>
      unserviceable
    </div>
  ),
}));

function Marketplace() {
  return <div data-testid="marketplace-content">Home feed</div>;
}

describe("ServiceabilityGate", () => {
  it("edge case 1/6 — no-location → renders the marketplace children unchanged", () => {
    mockResult = { status: "no-location", isUnserviceable: false, message: null, lat: null, lng: null, area: null, retry };
    render(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();
    expect(screen.queryByTestId("unserviceable-area-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("serviceability-checking")).not.toBeInTheDocument();
    expect(screen.queryByTestId("serviceability-error")).not.toBeInTheDocument();
  });

  it("serviceable location → renders the marketplace children unchanged", () => {
    mockResult = { status: "serviceable", isUnserviceable: false, message: null, lat: 21.19, lng: 81.33, area: null, retry };
    render(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();
    expect(screen.queryByTestId("unserviceable-area-stub")).not.toBeInTheDocument();
  });

  it("checking → renders a loading state, NOT the marketplace and NOT the unserviceable screen", () => {
    mockResult = { status: "checking", isUnserviceable: false, message: null, lat: 21.19, lng: 81.33, area: null, retry };
    render(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    expect(screen.getByTestId("serviceability-checking")).toBeInTheDocument();
    expect(screen.queryByTestId("marketplace-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unserviceable-area-stub")).not.toBeInTheDocument();
  });

  it("edge case 10 — error → renders a retry state, NOT the marketplace and NOT the unserviceable screen", () => {
    mockResult = {
      status: "error", isUnserviceable: false, message: "Check your connection and try again.",
      lat: 21.19, lng: 81.33, area: null, retry,
    };
    render(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    expect(screen.getByTestId("serviceability-error")).toBeInTheDocument();
    expect(screen.queryByTestId("marketplace-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unserviceable-area-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("serviceability-retry")).toBeInTheDocument();
  });

  it("error state's Retry button calls the hook's retry()", () => {
    retry.mockClear();
    mockResult = { status: "error", isUnserviceable: false, message: null, lat: 21.19, lng: 81.33, area: null, retry };
    render(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    screen.getByTestId("serviceability-retry").click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("confirmed unserviceable location → renders UnserviceableArea with the hook's lat/lng/area, instead of the marketplace", () => {
    mockResult = {
      status: "unserviceable", isUnserviceable: true, message: "not deliverable",
      lat: 12.97, lng: 77.59, area: "Bengaluru", retry,
    };
    render(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    const stub = screen.getByTestId("unserviceable-area-stub");
    expect(stub).toBeInTheDocument();
    expect(stub).toHaveAttribute("data-lat", "12.97");
    expect(stub).toHaveAttribute("data-lng", "77.59");
    expect(stub).toHaveAttribute("data-area", "Bengaluru");
    expect(screen.queryByTestId("marketplace-content")).not.toBeInTheDocument();
  });

  it("serviceable → unserviceable → serviceable transitions cleanly on rerender (no hard reload needed)", () => {
    mockResult = { status: "serviceable", isUnserviceable: false, message: null, lat: 21.19, lng: 81.33, area: null, retry };
    const { rerender } = render(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();

    mockResult = { status: "unserviceable", isUnserviceable: true, message: "nope", lat: 1, lng: 1, area: null, retry };
    rerender(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    expect(screen.getByTestId("unserviceable-area-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("marketplace-content")).not.toBeInTheDocument();

    mockResult = { status: "serviceable", isUnserviceable: false, message: null, lat: 21.19, lng: 81.33, area: null, retry };
    rerender(<ServiceabilityGate><Marketplace /></ServiceabilityGate>);
    expect(screen.getByTestId("marketplace-content")).toBeInTheDocument();
    expect(screen.queryByTestId("unserviceable-area-stub")).not.toBeInTheDocument();
  });
});
