import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Frontend component/DOM tests need jsdom. Server modules (server/**) run
    // under the real "node" environment via a per-file docblock
    // (// @vitest-environment node) — they touch fs, crypto and sockets.
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.mjs"],
  },
});
