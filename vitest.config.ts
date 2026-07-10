import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    // Frontend component/DOM tests need jsdom. Server modules (server/**) run
    // under the real "node" environment via a per-file docblock
    // (// @vitest-environment node) — they touch fs, crypto and sockets.
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/api/**", "src/store/**", "server/**"],
    },
  },
});
