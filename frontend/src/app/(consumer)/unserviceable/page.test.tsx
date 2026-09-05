/**
 * Phase 9C — /unserviceable QA preview route.
 *
 * Confirms: the route renders successfully, it renders the REAL
 * UnserviceableArea component (not a second implementation — asserted via
 * that component's own testid and headline copy), and merely opening the
 * route never submits a real waitlist request (the deeper previewMode
 * behavior itself — including a guest's phone-form submission — is
 * covered in UnserviceableArea.test.tsx; this file only has to prove the
 * route wires previewMode through correctly).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UnserviceablePreviewPage from "./page";

let mockPhone: string | null = null;
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
});

describe("/unserviceable preview route", () => {
  it("renders successfully and shows the preview banner", () => {
    render(<UnserviceablePreviewPage />);
    expect(screen.getByTestId("unserviceable-preview-banner")).toBeInTheDocument();
  });

  it("renders the EXACT same UnserviceableArea production component (same testid, same copy)", () => {
    render(<UnserviceablePreviewPage />);
    expect(screen.getByTestId("unserviceable-area")).toBeInTheDocument();
    expect(screen.getByText("Lokl isn't here yet")).toBeInTheDocument();
    expect(screen.getByTestId("request-area-cta")).toBeInTheDocument();
    // Neutral label — never falsely claims Bhilai (Phase 9C review-pass bug fix).
    expect(screen.getByTestId("city-display-block")).toHaveTextContent("your area");
  });

  it("merely opening the route never submits a real waitlist request", () => {
    render(<UnserviceablePreviewPage />);
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("clicking the CTA on the preview route still never submits a real waitlist request (previewMode wired through)", async () => {
    mockPhone = "919876543210";
    const user = userEvent.setup();
    render(<UnserviceablePreviewPage />);
    await user.click(screen.getByTestId("request-area-cta"));

    expect(await screen.findByTestId("request-area-success")).toBeInTheDocument();
    expect(joinWaitlist).not.toHaveBeenCalled();
  });
});
