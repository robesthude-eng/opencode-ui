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
let pwaPlugin: any[] = [];
try {
  // optional dep – optional dep
  const { VitePWA } = await import("vite-plugin-pwa");
  pwaPlugin = [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
      manifest: {
        name: "OpenCode UI",
        short_name: "OpenCode",
        description: "A custom web UI for OpenCode",
        theme_color: "#0b0b0f",
        background_color: "#0b0b0f",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\/api\/.*/i,
            handler: "NetworkFirst",
            options: { cacheName: "api-cache", networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ];
} catch {}

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
