// Lint for the legacy Node API (server/), the shared TypeScript rules (src/domain), the core and
// full-stack tests and the scripts. The Expo app and its eslint-config-expo setup are retired
// (MAZ-98); the native app and the web app (apps/ios, apps/web) have their own linters.
const { defineConfig } = require("eslint/config");
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");

const transport = ["express", "express-*", "cors", "**/http/**"];
const composition = ["**/app.ts", "**/index.ts"];
const storage = ["node:sqlite", "node:crypto", "node:fs", "node:fs/*", "node:http", "node:https", "**/infrastructure/**"];

function boundary(files, group, message, ignores = []) {
  return {
    files,
    ignores,
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group, message }] }],
    },
  };
}

module.exports = defineConfig([
  { ignores: ["apps/**", "node_modules/**", "coverage/**", "dist/**", ".cache/**", "design-kit/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // The legacy code and its tests read untyped JSON fixtures and wire payloads.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  { files: ["**/*.js", "**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  boundary(
    ["src/domain/**/*.ts"],
    ["**/server/**", "node:*"],
    "Domain rules must remain platform-independent: no backend or Node APIs.",
  ),
  boundary(
    ["server/application/**/*.ts"],
    [...transport, ...storage, ...composition],
    "Services depend on validation, domain rules and typed ports; inject storage and security from the composition root.",
  ),
  boundary(
    ["server/validation/**/*.ts"],
    [...transport, ...storage, ...composition, "node:*", "**/application/**"],
    "Validation must remain free of application orchestration, storage and HTTP dependencies.",
  ),
  boundary(
    ["server/http/**/*.ts"],
    [...storage, ...composition],
    "HTTP adapters call application services; SQL and cryptography belong to infrastructure.",
  ),
  boundary(
    ["server/infrastructure/**/*.ts"],
    [...transport, ...composition, "**/application/auth.ts", "**/application/ledger.ts", "**/application/receipts.ts"],
    "Infrastructure implements application ports without importing services or HTTP adapters.",
  ),
]);
