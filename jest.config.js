const shared = {
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/tests/ui/support/setup-ui.ts"],
};

module.exports = {
  projects: ["ios"].map((platform) => ({
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
  })),
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
  coverageDirectory: "<rootDir>/coverage/ui",
  coverageProvider: "babel",
  coverageReporters: ["text-summary", "html", "lcovonly", "json-summary"],
};
