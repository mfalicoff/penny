import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  // index.html shows the README's screenshots straight from docs/screenshots.
  server: { fs: { allow: [repositoryRoot] } },
  worker: { format: "es" },
  build: { target: "es2022", assetsInlineLimit: 0 },
  test: { include: ["test/**/*.test.ts"] },
});
