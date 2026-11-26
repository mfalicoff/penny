// Lint for the product page, its splat renderer and tests.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["node_modules/**", "dist/**", ".wrangler/**", "splats/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    // Scene generation runs in the page, the worker and Node: no platform APIs.
    files: ["src/scenes/**/*.ts", "src/splats/{cloud,random,morph,sort,pack,mat4}.ts"],
    languageOptions: { globals: {} },
  },
  {
    files: ["scripts/**/*.ts", "test/**/*.ts", "docs/**/*.ts", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
]);
