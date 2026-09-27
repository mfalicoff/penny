// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["react", "react-native", "expo", "expo-*", "@expo/*", "**/data/**", "**/features/**", "**/providers/**", "**/shell/**", "**/shared/**", "**/app/**"],
          message: "Domain rules must remain platform-independent and testable without React.",
        }],
      }],
    },
  },
  {
    files: ["src/{data,shared,providers}/**/*.{ts,tsx}"],
    ignores: ["**/__tests__/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/features/**", "**/shell/**", "**/app/**"],
          message: "Infrastructure and shared code must not depend on screens or app composition.",
        }],
      }],
    },
  },
]);
