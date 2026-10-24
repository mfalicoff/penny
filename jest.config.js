const shared = {
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/tests/ui/support/setup-ui.ts"],
};

module.exports = {
  projects: [
    ...(["ios", "android"].map((platform) => ({
      ...shared,
      displayName: platform,
      preset: `jest-expo/${platform}`,
      transform: {
        "\\.[jt]sx?$": ["babel-jest", {
          presets: [require.resolve("expo/internal/babel-preset")],
          caller: { name: "metro", bundler: "metro", platform },
        }],
      },
      testMatch: ["<rootDir>/tests/ui/**/*.test.ts?(x)"],
    }))),
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
      testMatch: ["<rootDir>/tests/ui/**/*.web.test.jsx"],
    },
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
  coverageDirectory: "<rootDir>/coverage/ui",
  coverageProvider: "babel",
  coverageReporters: ["text-summary", "html", "lcovonly", "json-summary"],
};
