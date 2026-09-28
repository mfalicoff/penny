import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npm, ["run", "build:web", "--", "--clear"], {
  stdio: "inherit",
  env: {
    ...process.env,
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_API_URL: "http://127.0.0.1:4173",
  },
});

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);

if (run.error) throw run.error;
process.exit(run.status ?? 1);
