// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const { fixupConfigRules } = require("@eslint/compat");
const expoConfig = require("eslint-config-expo/flat");

const frontendRuntime = [
  "react", "react-native", "expo", "expo-*", "@expo/*",
  "**/src/app/**", "**/src/data/**", "**/src/features/**",
  "**/src/providers/**", "**/src/shared/**", "**/src/shell/**",
];
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
  ...fixupConfigRules(expoConfig),
  { ignores: ["dist/*"] },
  boundary(
    ["src/domain/**/*.{ts,tsx}"],
    ["react", "react-native", "expo", "expo-*", "@expo/*", "**/server/**", "**/data/**", "**/features/**", "**/providers/**", "**/shell/**", "**/shared/**", "**/app/**"],
    "Domain rules must remain platform-independent and testable without React.",
  ),
  boundary(
    ["src/{data,shared,providers}/**/*.{ts,tsx}"],
    ["**/server/**", "**/features/**", "**/shell/**", "**/app/**"],
    "Infrastructure and shared code must not depend on screens, app composition or backend implementations.",
  ),
  boundary(
    ["src/{features,shell,app}/**/*.{ts,tsx}"],
    ["**/server/**"],
    "Frontend code must communicate with the backend through the API.",
  ),
  boundary(
    ["server/**/*.ts"],
    frontendRuntime,
    "Backend code may share pure domain rules, but must not depend on the frontend runtime.",
  ),
  boundary(
    ["server/application/**/*.ts"],
    [...frontendRuntime, ...transport, ...storage, ...composition],
    "Services depend on validation, domain rules and typed ports; inject storage and security from the composition root.",
  ),
  boundary(
    ["server/validation/**/*.ts"],
    [...frontendRuntime, ...transport, ...storage, ...composition, "node:*", "**/application/**"],
    "Validation must remain free of application orchestration, storage and HTTP dependencies.",
  ),
  boundary(
    ["server/http/**/*.ts"],
    [...frontendRuntime, ...storage, ...composition],
    "HTTP adapters call application services; SQL and cryptography belong to infrastructure.",
  ),
  boundary(
    ["server/infrastructure/**/*.ts"],
    [...frontendRuntime, ...transport, ...composition, "**/application/auth.ts", "**/application/ledger.ts", "**/application/receipts.ts"],
    "Infrastructure implements application ports without importing services or HTTP adapters.",
  ),
]);
