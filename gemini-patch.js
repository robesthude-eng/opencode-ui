// Патч для @ai-sdk/google - заменяет endpoint на Cloudflare Worker
const originalFetch = globalThis.fetch;

globalThis.fetch = function (url, options) {
  if (
    typeof url === "string" &&
    url.includes("generativelanguage.googleapis.com")
  ) {
    url = url.replace(
      "https://generativelanguage.googleapis.com",
      "https://browserai-proxy.robesthud.workers.dev",
    );
  }
  return originalFetch(url, options);
};

console.log("[PATCH] Gemini endpoint patched to Cloudflare Worker");
