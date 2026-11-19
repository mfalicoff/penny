import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Only a human approves a deviation from a design card (docs/design/visual-acceptance.md#recording-verdicts).
// This check fails a pull request that adds an `approved` deviation to contracts/visual-comparisons.json,
// or adds or changes a line under "Approved deviations" in docs/reference/redesign.md, unless a person
// applied the `design-approved` label to the pull request. Removing approved deviations passes: that is
// how they become follow-ups.

export const comparisonsPath = "contracts/visual-comparisons.json";
export const redesignPath = "docs/reference/redesign.md";
export const overrideLabel = "design-approved";

const sides = ["native", "web"];

// One string per approved deviation: card, side, summary and the section that approves it.
export function approvedDeviations(comparisonsJson) {
  const { cards = [] } = JSON.parse(comparisonsJson);
  const approved = [];
  for (const card of cards) {
    for (const side of sides) {
      for (const deviation of card?.[side]?.deviations ?? []) {
        if (deviation?.kind === "approved") {
          approved.push(`${card.id} (${side}): ${deviation.summary} [${deviation.ref}]`);
        }
      }
    }
  }
  return approved;
}

// The non-blank lines of the "## Approved deviations" section, up to the next level-2 heading.
// Null when the section is missing.
export function approvedSection(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Approved deviations\b/.test(line));
  if (start === -1) return null;
  const section = [];
  for (const line of lines.slice(start)) {
    if (section.length > 0 && /^## /.test(line)) break;
    if (line.trim() !== "") section.push(line.trimEnd());
  }
  return section;
}

// Items of `after` that aren't in `before`, counting duplicates.
function added(before, after) {
  const remaining = new Map();
  for (const item of before) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  const result = [];
  for (const item of after) {
    const count = remaining.get(item) ?? 0;
    if (count > 0) remaining.set(item, count - 1);
    else result.push(item);
  }
  return result;
}

// The problems with the change from `base` to `head`, each { base, head } holding both files' text.
// Empty when the change adds no approval.
export function checkDesignDeviations({ base, head }) {
  const problems = [];

  const baseApproved = approvedDeviations(base.comparisons);
  const headApproved = approvedDeviations(head.comparisons);
  const newApproved = added(baseApproved, headApproved);
  if (newApproved.length > 0) {
    problems.push(
      `${comparisonsPath} adds ${newApproved.length} approved deviation(s) ` +
        `(${baseApproved.length} before, ${headApproved.length} after):\n` +
        newApproved.map((item) => `  + ${item}`).join("\n"),
    );
  }

  const baseSection = approvedSection(base.redesign);
  const headSection = approvedSection(head.redesign);
  if (baseSection !== null && headSection === null) {
    problems.push(`${redesignPath} no longer has its "## Approved deviations" section.`);
  } else if (headSection !== null) {
    const newLines = added(baseSection ?? [], headSection);
    if (newLines.length > 0) {
      problems.push(
        `${redesignPath} adds or changes ${newLines.length} line(s) under "Approved deviations":\n` +
          newLines.map((line) => `  + ${line.length > 160 ? `${line.slice(0, 157)}...` : line}`).join("\n"),
      );
    }
  }

  return problems;
}

export function hasOverride(labelsJson) {
  if (!labelsJson) return false;
  const labels = JSON.parse(labelsJson);
  return Array.isArray(labels) && labels.some((label) => (label?.name ?? label) === overrideLabel);
}

function readAt(ref, path) {
  return execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Usage: node scripts/design-deviations.mjs [--base <git ref>]   (default origin/master)
// CI checks out the pull request's merge commit and passes --base HEAD^1, the base branch it merges into,
// with the pull request's labels as JSON in PR_LABELS.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const baseIndex = process.argv.indexOf("--base");
  const baseRef = baseIndex === -1 ? "origin/master" : process.argv[baseIndex + 1];
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const problems = checkDesignDeviations({
    base: { comparisons: readAt(baseRef, comparisonsPath), redesign: readAt(baseRef, redesignPath) },
    head: {
      comparisons: readFileSync(`${root}/${comparisonsPath}`, "utf8"),
      redesign: readFileSync(`${root}/${redesignPath}`, "utf8"),
    },
  });

  if (problems.length === 0) {
    console.log(`No new approved design deviations against ${baseRef}.`);
  } else if (hasOverride(process.env.PR_LABELS)) {
    console.log(`The \`${overrideLabel}\` label is on the pull request, so a person approved these changes:\n`);
    console.log(problems.join("\n\n"));
  } else {
    console.error(problems.join("\n\n"));
    console.error(
      `::error title=Approved design deviations::Only a human approves a deviation from a design card. ` +
        `Record the difference as a follow-up deviation and post a "Design decision:" follow-up instead, ` +
        `or have a person apply the \`${overrideLabel}\` label to this pull request. ` +
        "See docs/design/visual-acceptance.md#recording-verdicts.",
    );
    process.exit(1);
  }
}
