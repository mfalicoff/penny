import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDirectory = mkdtempSync(join(tmpdir(), "penny-playwright-"));
const child = spawn(
  process.execPath,
  ["--experimental-strip-types", "server/index.ts"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "4173",
      DATABASE_PATH: join(dataDirectory, "penny.sqlite"),
      ALLOW_REGISTRATION: "true",
      COOKIE_SECURE: "false",
      CORS_ORIGINS: "http://127.0.0.1:4173",
      EXPO_PUBLIC_API_URL: "",
    },
  },
);

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("exit", () => rmSync(dataDirectory, { recursive: true, force: true }));

child.on("error", (error) => {
  console.error("Could not start the Playwright test server:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  rmSync(dataDirectory, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
