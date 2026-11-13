import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import pluginQuery from "@tanstack/eslint-plugin-query";
import pluginRouter from "@tanstack/eslint-plugin-router";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "coverage", "test-results", "playwright-report", "src/routeTree.gen.ts"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  pluginRouter.configs["flat/recommended"],
  pluginQuery.configs["flat/recommended"],
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // TanStack Router's notFound()/redirect() are thrown by design.
      "@typescript-eslint/only-throw-error": [
        "error",
        { allow: [{ from: "package", package: "@tanstack/router-core", name: ["NotFoundError", "Redirect"] }] },
      ],
      // Keep the browser bundle free of server-only configuration.
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Browser code must not read process.env; use same-origin /api." },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.config.{js,ts}", "scripts/**/*.ts", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "no-restricted-properties": "off" },
  },
  { files: ["eslint.config.js"], extends: [tseslint.configs.disableTypeChecked] },
);
