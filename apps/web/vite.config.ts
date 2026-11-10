/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";

const designKit = fileURLToPath(new URL("../../design-kit", import.meta.url));
const appRoot = fileURLToPath(new URL(".", import.meta.url));

// The browser always calls /api/ on its own origin (production: the nginx proxy in
// deploy/web). In development and preview, Vite forwards /api/ to the real .NET API.
// PENNY_API_URL is read here, on the Node side, and never reaches the bundle: only
// PENNY_PUBLIC_* variables are exposed to client code (envPrefix below).
const apiTarget = process.env.PENNY_API_URL ?? "http://127.0.0.1:8080";
const apiProxy: Record<string, ProxyOptions> = {
  "/api": { target: apiTarget, changeOrigin: false, xfwd: true },
};

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
  ],
  resolve: {
    alias: { "@design-kit": designKit },
  },
  envPrefix: "PENNY_PUBLIC_",
  server: {
    // 4173 is an origin the API allows by default (Auth__AllowedOrigins, test-env).
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
    fs: { allow: [appRoot, designKit] },
  },
  preview: {
    port: Number(process.env.PENNY_WEB_PORT ?? 4173),
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
