// Only a human approves a deviation from a design card (scripts/design-deviations.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approvedDeviations,
  approvedSection,
  checkDesignDeviations,
  hasOverride,
} from "../../scripts/design-deviations.mjs";

const redesign = `# Redesign

## Web notes (MAZ-90)

- **Rows.** Title left, amount right.

## Approved deviations (MAZ-122)

A deviation is approved only when a human approves it.

### Web adaptations (MAZ-122)

- **Calendar.** The calendar is a section of Home, not a sheet.
- **Trips.** The next trip is a feature card.

## Design gaps

- Real keyboard.
`;

function comparisons(deviations: Array<{ summary: string; kind: string; ref: string }>) {
  return JSON.stringify({
    cards: [
      { id: "iphone-home", native: { status: "matches" }, web: { status: deviations.length ? "deviates" : "matches", deviations } },
    ],
  });
}

const calendar = { summary: "The calendar is a section", kind: "approved", ref: "docs/reference/redesign.md#web-adaptations-maz-122" };
const sidebar = { summary: "More instead of the Settings sheet", kind: "follow-up", ref: "MAZ-173" };
const base = { comparisons: comparisons([calendar, sidebar]), redesign };

test("an unchanged record passes", () => {
  assert.deepEqual(checkDesignDeviations({ base, head: base }), []);
});

test("removing approved deviations and their entries passes", () => {
  const head = {
    comparisons: comparisons([sidebar, { ...calendar, kind: "follow-up", ref: "MAZ-215" }]),
    redesign: redesign.replace("- **Trips.** The next trip is a feature card.\n", ""),
  };
  assert.deepEqual(checkDesignDeviations({ base, head }), []);
});

test("changes outside the Approved deviations section pass", () => {
  const head = {
    ...base,
    redesign: redesign.replace("Title left, amount right.", "Title left, amount right, from 320px.").replace("- Real keyboard.", "- Real keyboard and focus."),
  };
  assert.deepEqual(checkDesignDeviations({ base, head }), []);
});

test("adding an approved deviation fails", () => {
  const head = { ...base, comparisons: comparisons([calendar, sidebar, { ...calendar, summary: "No server chip" }]) };
  const problems = checkDesignDeviations({ base, head });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /adds 1 approved deviation\(s\) \(1 before, 2 after\)/);
  assert.match(problems[0], /iphone-home \(web\): No server chip/);
});

test("turning a follow-up into an approved deviation fails", () => {
  const head = { ...base, comparisons: comparisons([calendar, { ...sidebar, kind: "approved", ref: calendar.ref }]) };
  assert.equal(checkDesignDeviations({ base, head }).length, 1);
});

test("swapping one approved deviation for another fails even though the count is the same", () => {
  const head = { ...base, comparisons: comparisons([{ ...calendar, summary: "The calendar is a page" }, sidebar]) };
  assert.match(checkDesignDeviations({ base, head })[0], /1 before, 1 after/);
});

test("adding, widening or rewording an entry under Approved deviations fails", () => {
  for (const changed of [
    redesign.replace("- **Trips.**", "- **Sign-in.** No server chip.\n- **Trips.**"),
    redesign.replace("a feature card.", "a feature card, and the grid has no New trip card."),
    redesign.replace("only when a human approves it", "when it follows the platform"),
    redesign.replace("### Web adaptations (MAZ-122)", "### Web adaptations (MAZ-122)\n\n### iPad adaptations"),
  ]) {
    const problems = checkDesignDeviations({ base, head: { ...base, redesign: changed } });
    assert.equal(problems.length, 1, changed);
    assert.match(problems[0], /adds or changes 1 line\(s\) under "Approved deviations"/);
  }
});

test("dropping the Approved deviations heading fails", () => {
  const head = { ...base, redesign: redesign.replace("## Approved deviations (MAZ-122)", "## Adaptations") };
  assert.match(checkDesignDeviations({ base, head })[0], /no longer has its "## Approved deviations" section/);
});

test("the section runs to the next level-2 heading and keeps its subsections", () => {
  const section = approvedSection(redesign) ?? [];
  assert.equal(section[0], "## Approved deviations (MAZ-122)");
  assert.ok(section.includes("### Web adaptations (MAZ-122)"));
  assert.ok(!section.some((line) => line.includes("Design gaps") || line.includes("Real keyboard")));
});

test("the design-approved label overrides the check", () => {
  assert.equal(hasOverride(JSON.stringify([{ name: "agent" }, { name: "design-approved" }])), true);
  assert.equal(hasOverride(JSON.stringify(["design-approved"])), true);
  assert.equal(hasOverride(JSON.stringify([{ name: "agent" }])), false);
  assert.equal(hasOverride("[]"), false);
  assert.equal(hasOverride(undefined), false);
});

test("the repository's own record parses", () => {
  const root = new URL("../../", import.meta.url);
  const approved = approvedDeviations(readFileSync(new URL("contracts/visual-comparisons.json", root), "utf8"));
  assert.ok(approved.length > 0);
  assert.notEqual(approvedSection(readFileSync(new URL("docs/reference/redesign.md", root), "utf8")), null);
});
