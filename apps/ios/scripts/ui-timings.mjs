#!/usr/bin/env node
// Records how long a UI test plan took (MAZ-163), so a slowdown on CI shows up before it turns
// into timeouts. Reads `<device>.xcresult` and the device wall-clock times `ios.sh ui-test` wrote
// to `device-seconds.tsv` (device, seconds), then writes:
//
//   <results>/timings.json   { plan, devices: [{ device, seconds, tests: [{ name, result, seconds }] }] }
//
// and prints a table, also appended to the GitHub job summary when GITHUB_STEP_SUMMARY is set.
// Usage: node apps/ios/scripts/ui-timings.mjs <results dir> <plan>
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [results, plan] = process.argv.slice(2);
if (!results || !plan) {
  console.error("usage: ui-timings.mjs <results dir> <plan>");
  process.exit(2);
}

const wallClock = new Map();
const tsv = join(results, "device-seconds.tsv");
if (existsSync(tsv)) {
  for (const line of readFileSync(tsv, "utf8").split("\n")) {
    const [device, seconds] = line.split("\t");
    if (device && seconds) wallClock.set(device, Number(seconds));
  }
}

// Test cases with their duration, from `xcresulttool get test-results tests` (Xcode 16 and later).
function testCases(bundle) {
  if (!existsSync(bundle)) return [];
  let report;
  try {
    report = JSON.parse(
      execFileSync("xcrun", ["xcresulttool", "get", "test-results", "tests", "--path", bundle], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  } catch (error) {
    console.error(`warning: could not read ${bundle}: ${error.message.split("\n")[0]}`);
    return [];
  }
  const cases = [];
  const visit = (node, suite) => {
    if (node.nodeType === "Test Case") {
      cases.push({
        name: suite ? `${suite}/${node.name}` : node.name,
        result: node.result ?? "unknown",
        seconds: typeof node.durationInSeconds === "number" ? Math.round(node.durationInSeconds) : null,
      });
      return;
    }
    const nextSuite = node.nodeType === "Test Suite" ? node.name : suite;
    for (const child of node.children ?? []) visit(child, nextSuite);
  };
  for (const node of report.testNodes ?? []) visit(node, "");
  return cases;
}

const devices = [];
for (const device of ["iphone", "ipad"]) {
  const bundle = join(results, `${device}.xcresult`);
  if (!wallClock.has(device) && !existsSync(bundle)) continue;
  devices.push({ device, seconds: wallClock.get(device) ?? null, tests: testCases(bundle) });
}

writeFileSync(join(results, "timings.json"), `${JSON.stringify({ plan, devices }, null, 2)}\n`);

const rows = [`### UI test timings (${plan})`, "", "| Device | Test | Result | Seconds |", "| --- | --- | --- | ---: |"];
for (const { device, seconds, tests } of devices) {
  for (const test of tests) rows.push(`| ${device} | ${test.name} | ${test.result} | ${test.seconds ?? "?"} |`);
  rows.push(`| ${device} | **whole run** (install, launch and every test) | | ${seconds ?? "?"} |`);
}
const table = `${rows.join("\n")}\n`;
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
