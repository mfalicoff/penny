import { pathToFileURL } from "node:url";

// PRs are squash-merged, so the PR title becomes the commit on master, and Release Please
// picks the next version and the changelog from Conventional Commit messages
// (docs/development/releases.md#commit-messages-and-version-selection). A title such as
// "Update all dependencies" is silently left out of the release.
export const types = ["feat", "fix", "perf", "refactor", "revert", "docs", "test", "build", "ci", "style", "chore"];

const pattern = new RegExp(`^(${types.join("|")})(\\([a-z0-9][a-z0-9._/-]*\\))?(!)?: \\S`);

// Null for a valid title, else why it is not.
export function checkPrTitle(title) {
  if (typeof title !== "string" || title.trim().length === 0) return "The PR title is empty.";
  if (pattern.test(title)) return null;
  return (
    `"${title}" is not a Conventional Commit title. Use \`type(scope)!: summary\` with a lowercase type ` +
    `(${types.join(", ")}); the scope and \`!\` are optional, e.g. \`fix(deps): update all dependencies\`. ` +
    "See docs/development/releases.md#commit-messages-and-version-selection."
  );
}

// CI passes the title through the environment, never interpolated into the shell.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problem = checkPrTitle(process.env.PR_TITLE);
  if (problem) {
    console.error(`::error title=PR title::${problem}`);
    process.exit(1);
  }
  console.log(`PR title "${process.env.PR_TITLE}" is a Conventional Commit.`);
}
