// Lint for the Cloudflare Email Worker and its tests.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["node_modules/**", ".wrangler/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Logs carry only fixed outcome codes (never addresses or content); see src/log.ts.
      "no-console": ["error", { allow: ["log"] }],
    },
  },
]);
