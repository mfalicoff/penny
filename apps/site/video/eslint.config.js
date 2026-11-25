// Lint for the clip pipeline: compositions (browser), capture and render scripts (Node).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["node_modules/**", "captures/**", "out/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["capture/**/*.ts", "render.ts", "remotion.config.ts", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
]);
