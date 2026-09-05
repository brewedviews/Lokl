/**
 * Phase 10 — FirstLoadInterstitial: purely presentational, no logic of its
 * own (timing lives in LocationOnboardingGate). Covers the visual/
 * accessibility requirements directly: white background, centered
 * wordmark, the exact tagline text, a real heading (not a decorative
 * image), and zero interactive/focusable elements (so there is nothing
 * for focus to get trapped in).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirstLoadInterstitial } from "./FirstLoadInterstitial";

describe("FirstLoadInterstitial", () => {
  it("renders the wordmark as a real accessible heading", () => {
    render(<FirstLoadInterstitial />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("lokl.");
  });

  it("renders the exact required tagline text", () => {
    render(<FirstLoadInterstitial />);
    expect(screen.getByText("your neighbourhood online")).toBeInTheDocument();
  });

  it("has no buttons, links, or other focusable/interactive elements — nothing for focus to get trapped in", () => {
    render(<FirstLoadInterstitial />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("has no loading spinner (not technically necessary here)", () => {
    const { container } = render(<FirstLoadInterstitial />);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
