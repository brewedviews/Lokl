/**
 * Phase 9C (review pass) — UnserviceableArea screen behavior: accurate
 * current-location display (via the `area` prop passed down from
 * ServiceabilityGate/useLocationServiceability, NOT LocationChip's own
 * default resolution — see ConsumerHeader.tsx's `label` prop doc comment
 * for why), "Change location" reusing the real LocationChip picker, and
 * the "Request Lokl in your area" CTA for both a logged-in customer (no
 * form, immediate submit) and a guest (phone form, validated, then
 * submit) — now using the lat/lng/area passed in as props rather than
 * re-resolving them itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnserviceableArea } from "./UnserviceableArea";

let mockPhone: string | null = null;

// LocationChip (reused by UnserviceableArea) imports useLocationStore from
// this barrel and selects several of its action fields on mount (e.g.
// autoDetectIfGranted, called unconditionally in an effect) — these must
// be real no-op functions, or LocationChip throws calling `undefined()`.
// lat/lng themselves are irrelevant to this file's tests: the DISPLAY
// label now comes entirely from the `area` prop, not this store.
const mockLocationStoreState = {
  permission: "denied" as const,
  requestLocation: vi.fn(async () => {}),
  setLocation: vi.fn(),
  autoDetectIfGranted: vi.fn(async () => {}),
};

vi.mock("@/stores", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useCustomerAuthStore: (selector: (s: { phone: string | null }) => any) => selector({ phone: mockPhone }),
  useWishlistStore: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useLocationStore: (selector: (s: typeof mockLocationStoreState) => any) => selector(mockLocationStoreState),
}));

const apiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (...args: any[]) => apiGet(...args),
    post: vi.fn(),
  },
}));

const joinWaitlist = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    site: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      joinWaitlist: (...args: any[]) => joinWaitlist(...args),
    },
  },
}));

beforeEach(() => {
  mockPhone = null;

  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url.includes("addresses")) return Promise.resolve({ data: { addresses: [] } });
    return Promise.resolve({ data: {} });
  });

  joinWaitlist.mockReset();
  joinWaitlist.mockResolvedValue({ ok: true, message: "Registered successfully" });

  // LocationChip's body-scroll-lock effect calls matchMedia when opened —
  // jsdom doesn't implement it by default.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("UnserviceableArea", () => {
  it("shows the Lokl-native message and the resolved area as the location label — not a hardcoded/wrong one", () => {
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area="Bengaluru" />);
    expect(screen.getByText("Lokl isn't here yet")).toBeInTheDocument();
    const chip = screen.getByTestId("city-display-block");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("Bengaluru");
    expect(chip).not.toHaveTextContent("Bhilai");
  });

  it("location-label bug fix — when area couldn't be resolved, falls back to a generic honest label, never a guessed/wrong one", () => {
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area={null} />);
    const chip = screen.getByTestId("city-display-block");
    expect(chip).toHaveTextContent("your area");
    expect(chip).not.toHaveTextContent("Bhilai");
  });

  it("Change location reuses the real, existing LocationChip picker (no second flow)", async () => {
    const user = userEvent.setup();
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area="Bengaluru" />);
    const trigger = screen.getByTestId("city-display-block");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.queryByTestId("location-sheet") || screen.queryByTestId("location-popover"),
    ).toBeTruthy();
  });

  it("logged-in customer: CTA submits immediately (no phone form), passing the given lat/lng/area, and shows success", async () => {
    mockPhone = "919876543210";
    const user = userEvent.setup();
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area="Bengaluru" />);
    await user.click(screen.getByTestId("request-area-cta"));

    await waitFor(() => expect(joinWaitlist).toHaveBeenCalledTimes(1));
    expect(joinWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "919876543210",
        type: "customer",
        source: "unserviceable_area",
        area: "Bengaluru",
        lat: 12.9716,
        lng: 77.5946,
      }),
    );
    // No redundant cities/detect lookup — the CTA now uses the area/lat/
    // lng it was given, not a second fetch of its own. (apiGet IS called
    // once here, but for LocationChip's own unrelated saved-addresses
    // fetch — that's pre-existing, legitimate behavior, not what this
    // assertion is guarding against.)
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining("cities/detect"), expect.anything());
    expect(await screen.findByTestId("request-area-success")).toBeInTheDocument();
    expect(screen.queryByTestId("request-area-phone-input")).not.toBeInTheDocument();
  });

  it("guest: CTA reveals a phone form; an invalid number is rejected client-side without calling the API", async () => {
    const user = userEvent.setup();
    render(<UnserviceableArea lat={null} lng={null} area={null} />);
    await user.click(screen.getByTestId("request-area-cta"));

    const input = await screen.findByTestId("request-area-phone-input");
    await user.type(input, "12345");
    await user.click(screen.getByTestId("request-area-submit"));

    expect(await screen.findByTestId("request-area-error")).toHaveTextContent(/valid 10-digit/i);
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("guest: a valid 10-digit number submits (even with no lat/lng/area — the saved-address-fallback case) and shows success", async () => {
    const user = userEvent.setup();
    render(<UnserviceableArea lat={null} lng={null} area="Sector 6" />);
    await user.click(screen.getByTestId("request-area-cta"));

    const input = await screen.findByTestId("request-area-phone-input");
    await user.type(input, "9876543210");
    await user.click(screen.getByTestId("request-area-submit"));

    await waitFor(() => expect(joinWaitlist).toHaveBeenCalledTimes(1));
    expect(joinWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "9876543210", type: "customer", source: "unserviceable_area",
        area: "Sector 6", lat: null, lng: null,
      }),
    );
    expect(await screen.findByTestId("request-area-success")).toBeInTheDocument();
  });

  it("a failed submission shows an inline error and does not silently succeed", async () => {
    mockPhone = "919876543210";
    joinWaitlist.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area="Bengaluru" />);
    await user.click(screen.getByTestId("request-area-cta"));

    expect(await screen.findByTestId("request-area-error")).toBeInTheDocument();
    expect(screen.queryByTestId("request-area-success")).not.toBeInTheDocument();
  });

  it("previewMode: the CTA shows the real success state WITHOUT ever calling the real waitlist API (the /unserviceable preview route's core safety guarantee)", async () => {
    mockPhone = "919876543210";
    const user = userEvent.setup();
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area="your area" previewMode />);
    await user.click(screen.getByTestId("request-area-cta"));

    expect(await screen.findByTestId("request-area-success")).toBeInTheDocument();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("previewMode: a guest submitting a phone number also never calls the real waitlist API", async () => {
    const user = userEvent.setup();
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area="your area" previewMode />);
    await user.click(screen.getByTestId("request-area-cta"));
    const input = await screen.findByTestId("request-area-phone-input");
    await user.type(input, "9876543210");
    await user.click(screen.getByTestId("request-area-submit"));

    expect(await screen.findByTestId("request-area-success")).toBeInTheDocument();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("previewMode omitted (real ServiceabilityGate usage) behaves exactly as before — still calls the real API", async () => {
    mockPhone = "919876543210";
    const user = userEvent.setup();
    render(<UnserviceableArea lat={12.9716} lng={77.5946} area="Bengaluru" />);
    await user.click(screen.getByTestId("request-area-cta"));

    await waitFor(() => expect(joinWaitlist).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("request-area-success")).toBeInTheDocument();
  });
});
