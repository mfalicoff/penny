/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import { contentSecurityPolicyFor } from "./scripts/security-headers.ts";

const designKit = fileURLToPath(new URL("../../design-kit", import.meta.url));
const appRoot = fileURLToPath(new URL(".", import.meta.url));
// The shared, platform-neutral ledger rules (MAZ-86): merge, recurrence, commands and local search.
const sharedDomain = fileURLToPath(new URL("../../src/domain", import.meta.url));

// The browser always calls /api/ on its own origin (production: the nginx proxy in
// deploy/web). In development and preview, Vite forwards /api/ to the real .NET API.
// PENNY_API_URL is read here, on the Node side, and never reaches the bundle: only
// PENNY_PUBLIC_* variables are exposed to client code (envPrefix below).
const apiTarget = process.env.PENNY_API_URL ?? "http://127.0.0.1:8080";
const apiProxy: Record<string, ProxyOptions> = {
  "/api": { target: apiTarget, changeOrigin: false, xfwd: true },
};

// Opt-in browser telemetry (MAZ-129) in development and preview, the way the production front
// ends publish it: PENNY_WEB_TELEMETRY_URL (a Faro collector, such as Grafana Cloud's) becomes
// /telemetry.json and is allowed in the preview CSP. Read here, never compiled into the bundle.
// Unset, public/telemetry.json keeps telemetry off.
const telemetryUrl = process.env.PENNY_WEB_TELEMETRY_URL ?? "";
if (telemetryUrl && !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/.test(telemetryUrl)) {
  throw new Error("PENNY_WEB_TELEMETRY_URL must be an http(s) URL with no query, quotes, spaces or semicolons");
}

function telemetryConfig(): Plugin {
  const serve = (server: { middlewares: { use: (path: string, handler: (req: unknown, res: import("node:http").ServerResponse) => void) => void } }) => {
    if (!telemetryUrl) return;
    server.middlewares.use("/telemetry.json", (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ collectorUrl: telemetryUrl }));
    });
  };
  return { name: "penny-telemetry-config", configureServer: serve, configurePreviewServer: serve };
}

// Ships the bundled font's license next to the font in every production build.
function thirdPartyLicenses(): Plugin {
  return {
    name: "penny-third-party-licenses",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "licenses/Inter-OFL.txt",
        source: readFileSync(`${designKit}/fonts/Inter-OFL.txt`, "utf8"),
      });
      this.emitFile({
        type: "asset",
        fileName: "licenses/Ionicons-MIT.txt",
        source:
          "Ionicons v7 outline glyphs (https://ionic.io/ionicons), via design-kit/src/icons.ts.\n" +
          "Released under the MIT License. Copyright (c) 2015-present Ionic (http://ionic.io/).\n",
      });
    },
  };
}

export default defineConfig({
  plugins: [
    // Must run before the React plugin: it generates src/routeTree.gen.ts.
    tanstackRouter({ target: "react", autoCodeSplitting: true, routeFileIgnorePattern: "\\.test\\." }),
    react(),
    thirdPartyLicenses(),
    telemetryConfig(),
  ],
  resolve: {
    alias: { "@design-kit": designKit, "@domain": sharedDomain },
  },
  // Transform every file, including the shared ../../src/domain, with this app's tsconfig.
  // Otherwise files outside apps/web pick up the root tsconfig.json, which extends
  // expo/tsconfig.base, and that only resolves where the root Expo dependencies are installed.
  tsconfig: "./tsconfig.app.json",
  envPrefix: "PENNY_PUBLIC_",
  server: {
    // 4173 is an origin the API allows by default (Auth__AllowedOrigins, test-env).
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
    fs: { allow: [appRoot, designKit, sharedDomain] },
  },
  preview: {
    port: Number(process.env.PENNY_WEB_PORT ?? 4173),
    strictPort: true,
    proxy: apiProxy,
    headers: { "Content-Security-Policy": contentSecurityPolicyFor(telemetryUrl) },
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // src/app/zodConfig.ts must run before Zod loads, so it gets a chunk of its own, which
        // the entry imports first (a module inlined into the entry would run after its imports).
        codeSplitting: { groups: [{ name: "zod-config", test: /src[\\/]app[\\/]zodConfig\.ts$/ }] },
        // The pdf.js worker ships as `pdf.worker.min.mjs`. Module workers need a JavaScript
        // Content-Type and the front end sends nosniff, so it is emitted as `.js`, which every
        // server's default MIME table already maps (not every nginx knows `.mjs`).
        assetFileNames: (asset) => (asset.names.some((name) => name.endsWith(".mjs")) ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]"),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
