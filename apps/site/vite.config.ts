import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import { docs } from "./scripts/docs/plugin.ts";
import { inlineIcons } from "./scripts/icons.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function inlineIconsPlugin(): Plugin {
  return { name: "penny-inline-icons", transformIndexHtml: inlineIcons };
}

export default defineConfig({
  plugins: [inlineIconsPlugin(), docs(repositoryRoot)],
  // The page uses the design kit's icons; the dev server may read outside apps/site.
  server: { fs: { allow: [repositoryRoot] } },
  worker: { format: "es" },
  build: { target: "es2022", assetsInlineLimit: 0 },
  test: { include: ["test/**/*.test.ts"] },
});
