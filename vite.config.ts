import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * The OpenCode headless server.
 *   opencode serve          # headless HTTP/SSE API (default port 4096)
 *   opencode web            # same server + built-in web UI
 *
 * Override the target with: OPENCODE_TARGET=http://host:4096 npm run dev
 */
const OPENCODE_TARGET =
  process.env.OPENCODE_TARGET ?? "http://localhost:4096";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Everything under /api is forwarded to the OpenCode server, same-origin.
      // This avoids CORS for both REST calls and the SSE event stream.
      "/api": {
        target: OPENCODE_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
