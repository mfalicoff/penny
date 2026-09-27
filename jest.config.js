const shared = {
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/tests/setup-ui.ts"],
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: "native",
      preset: "jest-expo",
      testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts?(x)"],
    },
    {
      ...shared,
      displayName: "web",
      preset: "jest-expo/web",
      transform: {
        "\\.[jt]sx?$": ["babel-jest", {
          presets: [require.resolve("expo/internal/babel-preset")],
          caller: { name: "metro", bundler: "metro", platform: "web" },
        }],
      },
      testMatch: ["<rootDir>/src/**/__tests__/**/*.web.test.jsx"],
    },
  ],
  collectCoverageFrom: ["src/{features,providers,data}/**/*.{ts,tsx}", "!**/__tests__/**"],
};
