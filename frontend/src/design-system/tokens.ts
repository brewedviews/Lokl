/**
 * Runtime design tokens — single source of truth for ANY context that can't
 * read Tailwind classes (chart styles, Razorpay theme params, Sentry-tinted
 * error UIs, mailto signatures, etc.).
 *
 * Values mirror @theme in globals.css. If you change a color here you MUST
 * change it there too — there is no codegen pipeline yet.
 */
export const tokens = {
  colors: {
    brandBg:        "#FDFBF7",
    brandPrimary:   "#0A1F5C",
    brandAccent:    "#E68910",
    brandAccentAlt: "#F59E0B",
    cardSurface:    "#FFFFFF",
    cardBorder:     "#E5E2DC",
    textPrimary:    "#0A1F5C",
    textMuted:      "#64748B",
    textSecondary:  "#595959",
  },
  radius: {
    card:   "1rem",
    cardLg: "1.5rem",
    full:   "9999px",
  },
  fonts: {
    display: '"Clash Display", "Satoshi", system-ui, sans-serif',
    sans:    '"Satoshi", system-ui, sans-serif',
  },
} as const;

export type ColorToken = keyof typeof tokens.colors;
export type RadiusToken = keyof typeof tokens.radius;
