import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Optional plugins – gracefully degrade if not installed (e.g. local Node 20)
let reactCompilerPlugin: any[] = [];
try {
  // optional dep – optional peer dep, may not be installed locally
  await import("babel-plugin-react-compiler");
  reactCompilerPlugin = [["babel-plugin-react-compiler", {}]];
} catch {}
// PWA temporarily disabled (was serving stale bundles).
// Keeping empty array so ...pwaPlugin spread in defineConfig stays valid.
const pwaPlugin: any[] = [];

/**
 * The OpenCode headless server.
 *   opencode serve          # headless HTTP/SSE API (default port 4096)
 *   opencode web            # same server + built-in web UI
 *
 * Override the target with: OPENCODE_TARGET=http://host:4096 npm run dev
 */
const OPENCODE_TARGET = process.env.OPENCODE_TARGET ?? "http://localhost:4096";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: reactCompilerPlugin,
      },
    }),
    tailwindcss(),
    ...pwaPlugin,
  ],
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
