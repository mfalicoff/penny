#!/usr/bin/env node
// Collects the redesign card captures of the Cards plan (MAZ-122, PennyUITests/Cards) from the
// exported attachments of `ios.sh ui-test cards` and writes them for review next to the baselines
// in docs/design/penny-ios/previews:
//
//   <dest>/<id>.<appearance>.png   one capture per card and appearance
//   <dest>/report.json             [{ id, appearance, status, file, device, view, note }]
//
// status: captured, not-built (no such native screen or state yet), blocked (the state can't be
// reached, e.g. a missing seeded receipt), not-applicable (web cards and system-foundations), or
// not-run (no result from its device: the test failed or the device was not in the run).
// Usage: node apps/ios/scripts/card-report.mjs <results dir with *-attachments> <dest>
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const [results, destination] = process.argv.slice(2);
if (!results || !destination) {
  console.error("usage: card-report.mjs <results dir> <dest>");
  process.exit(2);
}
const root = fileURLToPath(new URL("../../..", import.meta.url));
const states = JSON.parse(readFileSync(join(root, "contracts/fixtures/redesign-states.json"), "utf8")).states;

// Attachment name -> exported file, per device. XCTest suffixes names with `_<n>_<uuid>.<ext>`.
const devices = {};
for (const device of ["iphone", "ipad"]) {
  const directory = join(results, `${device}-attachments`);
  const manifest = join(directory, "manifest.json");
  if (!existsSync(manifest)) continue;
  const files = new Map();
  for (const test of JSON.parse(readFileSync(manifest, "utf8"))) {
    for (const attachment of test.attachments ?? []) {
      const name = attachment.suggestedHumanReadableName.replace(/_\d+_[0-9A-F-]{36}(\.[a-z0-9]+)?$/i, "");
      files.set(name, join(directory, attachment.exportedFileName));
    }
  }
  devices[device] = files;
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
const report = [];
for (const state of states) {
  const id = state.specimen;
  const native = state.platform === "iPhone" || state.platform === "iPad" || id === "system-widgets";
  const device = state.platform === "iPad" ? "ipad" : "iphone";
  const base = { device: native ? device : null, view: state.view };
  if (!native) {
    for (const appearance of state.appearances)
      report.push({ id, appearance, status: "not-applicable", file: null, ...base,
        note: state.platform === "Web" ? "Web card; native behavior is traced through its iPhone/iPad card" : "Static token reference, no app screen" });
    continue;
  }
  const files = devices[device];
  const result = files?.get(`card-${id}-report`);
  const recorded = result ? JSON.parse(readFileSync(result, "utf8")) : null;
  for (const appearance of state.appearances) {
    const entry = { id, appearance, status: recorded?.status ?? "not-run", file: null, ...base, note: recorded?.note ?? "" };
    if (!recorded) entry.note = files ? "No result: the test failed or was not selected" : `The ${device} run did not take place`;
    if (entry.status === "captured") {
      const capture = files.get(`card-${id}-${appearance}`);
      if (capture && existsSync(capture)) {
        const file = join(destination, `${id}.${appearance}.png`);
        copyFileSync(capture, file);
        entry.file = relative(destination, file);
      } else {
        entry.status = "not-run";
        entry.note = `The ${appearance} capture is missing`;
      }
    }
    report.push(entry);
  }
}
writeFileSync(join(destination, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const counts = report.reduce((all, entry) => ({ ...all, [entry.status]: (all[entry.status] ?? 0) + 1 }), {});
console.log(`Card captures: ${destination} ${JSON.stringify(counts)}`);
