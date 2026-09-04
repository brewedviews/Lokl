import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // Next's postcss.config.mjs uses a Next-specific string-plugin-name
  // shorthand (`plugins: ["@tailwindcss/postcss"]`) that Next's own
  // internal loader understands but Vite's standard postcss-load-config
  // resolution rejects ("Invalid PostCSS Plugin"). Tests render components,
  // not stylesheets, so short-circuit with an explicit empty inline config
  // rather than letting Vite auto-discover the Next-flavored file.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
