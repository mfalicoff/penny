import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Which macOS jobs of .github/workflows/ios.yml a change needs (MAZ-201). macOS runners are
// the slowest and scarcest in CI, so a pull request runs only the jobs whose inputs it
// changes. A job this skips reports "skipped", which branch rules count as passing.
//
// - app: the Swift job and the release job. They read apps/ios, the contracts the app and its
//   tests decode (design baseline, fixtures, OpenAPI, the Swift contracts package), the
//   frozen identifiers in docs/ios/ipa.md and ios-testflight.yml (AppIdentityTests), and
//   this workflow.
// - stack: the XCUITest smoke job, which also starts the real API (apps/backend), the test
//   environment (scripts/test-env) and PostgreSQL from the Nix flake.
//
// Renovate's backend dependency updates don't run the smoke job: backend.yml's full-stack
// suite covers the API they change. Release Please's branch only bumps versions and the
// changelog, and the TestFlight workflow runs every job again before it archives.

const workflowInputs = [".github/workflows/ios.yml", "scripts/ios-ci-scope.mjs"];
const appFiles = ["docs/ios/ipa.md", ".github/workflows/ios-testflight.yml", ...workflowInputs];
const contractsNotRead = ["contracts/README.md", "contracts/visual-comparisons.json"];
const stackFiles = ["flake.nix", "flake.lock"];

function isAppInput(file) {
  if (file.startsWith("apps/ios/")) return true;
  if (file.startsWith("contracts/")) return !contractsNotRead.includes(file);
  return appFiles.includes(file);
}

function isBackendInput(file) {
  return file.startsWith("apps/backend/") && !file.startsWith("apps/backend/tests/") && !file.endsWith(".md");
}

// files: paths the pull request changes. headRef: its branch. event: the event name, which in
// a called workflow (ios-testflight.yml) is the caller's.
/** @param {{ event: string, headRef?: string, files?: string[] }} change */
export function iosJobs({ event, headRef = "", files = [] }) {
  if (event === "push") return { app: false, stack: false };
  if (event !== "pull_request") return { app: true, stack: true };
  if (headRef.startsWith("release-please--")) return { app: false, stack: false };

  const renovate = headRef.startsWith("renovate/");
  const app = files.some(isAppInput);
  const stack =
    app ||
    files.some(
      (file) =>
        stackFiles.includes(file) || file.startsWith("scripts/test-env/") || (!renovate && isBackendInput(file)),
    );
  return { app, stack };
}

// CI: the changed paths on stdin (one per line), the event and branch through the environment.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const event = process.env.EVENT_NAME ?? "";
  const files = event === "pull_request" ? readFileSync(0, "utf8").split("\n").filter(Boolean) : [];
  const jobs = iosJobs({ event, headRef: process.env.HEAD_REF ?? "", files });
  console.log(`${event} ${process.env.HEAD_REF ?? ""}: ${files.length} changed files`);
  console.log(`app jobs: ${jobs.app}, full-stack smoke: ${jobs.stack}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `app=${jobs.app}\nstack=${jobs.stack}\n`);
  }
}
