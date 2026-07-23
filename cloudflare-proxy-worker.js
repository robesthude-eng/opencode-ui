/**
 * Universal AI API Proxy — Cloudflare Worker
 *
 * Проксирует запросы к AI провайдерам для обхода гео-блокировок из РФ.
 * Деплой: wrangler deploy cloudflare-proxy-worker.js
 *
 * Routing по path prefix:
 *   /v1beta/*          → generativelanguage.googleapis.com/v1beta/*  (Gemini)
 *   /openai/v1/*       → api.openai.com/v1/*
 *   /anthropic/v1/*    → api.anthropic.com/v1/*
 *   /xai/v1/*          → api.x.ai/v1/*
 *   /mistral/v1/*      → api.mistral.ai/v1/*
 *   /cohere/v2/*       → api.cohere.ai/v2/*
 *
 * Headers (Authorization, Content-Type, etc.) пробрасываются as-is.
 * CORS разрешён для browser-based запросов.
 */

const ROUTES = {
  "/v1beta":    "https://generativelanguage.googleapis.com",
  "/openai":    "https://api.openai.com",
  "/anthropic": "https://api.anthropic.com",
  "/xai":       "https://api.x.ai",
  "/mistral":   "https://api.mistral.ai",
  "/cohere":    "https://api.cohere.ai",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version, api-key",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Find matching route
    let upstream = null;
    let strippedPath = path;

    for (const [prefix, target] of Object.entries(ROUTES)) {
      if (path.startsWith(prefix)) {
        upstream = target;
        strippedPath = path.slice(prefix.length) || "/";
        break;
      }
    }

    if (!upstream) {
      return new Response(
        JSON.stringify({
          error: "Unknown route",
          hint: `Valid prefixes: ${Object.keys(ROUTES).join(", ")}`,
          path,
        }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // Build upstream URL
    const upstreamUrl = new URL(strippedPath + url.search, upstream);

    // Forward headers (remove host, cf-*, etc.)
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");

    // Proxy request
    const response = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      redirect: "follow",
    });

    // Build response with CORS headers
    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(key, value);
    }
    // Remove restrictive headers from upstream
    responseHeaders.delete("x-frame-options");
    responseHeaders.delete("content-security-policy");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
