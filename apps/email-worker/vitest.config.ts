import { defineConfig } from "vitest/config";

// The Worker only uses Web Crypto, fetch and streams, which Node 24 provides, so the
// handler is tested directly with fake messages and a fake Penny.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
