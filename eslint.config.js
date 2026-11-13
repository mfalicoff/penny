// Lint for the shared TypeScript rules (src/domain) and the ledger write schema (src/validation),
// the core and full-stack tests and the scripts. The native app and the web app (apps/ios,
// apps/web) have their own linters.
const { defineConfig } = require("eslint/config");
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");

module.exports = defineConfig([
  { ignores: ["apps/**", "node_modules/**", "coverage/**", "dist/**", ".cache/**", "design-kit/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Tests and scripts read untyped JSON fixtures and wire payloads.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  { files: ["**/*.js", "**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["node:*", "zod", "../validation/**"], message: "Domain rules must remain platform-independent: no packages or Node APIs." }],
      }],
    },
  },
]);
