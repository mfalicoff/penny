// Legacy-versus-.NET contract comparison (MAZ-62). Runs the `differential` seed scenario
// and its probes against a throwaway legacy Node/SQLite server and a full-stack .NET
// environment, normalizes generated values and reports every difference that is not a
// documented deliberate one. SQLite is used only here, as the legacy reference; v2
// database tests always use PostgreSQL.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { control, freePort, root } from "./environment.mjs";
import { client, resolve, scenario as findScenario, seed } from "./seed.mjs";

/**
 * Starts the legacy server on a temporary SQLite database. `clockFile` preloads
 * legacy-clock.mjs so the server's time follows that file (cutover rehearsal).
 * `stop({ keep: true })` stops the server but keeps `databasePath`; `remove()`
 * deletes it.
 */
export async function startLegacy({ clockFile } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "penny-legacy-"));
  const databasePath = join(directory, "penny.sqlite");
  const port = await freePort();
  const preload = clockFile ? ["--import", join(root, "scripts/test-env/legacy-clock.mjs")] : [];
  const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", ...preload, "server/index.ts"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      HOST: "127.0.0.1", PORT: String(port), DATABASE_PATH: databasePath,
      ALLOW_REGISTRATION: "true", COOKIE_SECURE: "false", CORS_ORIGINS: "http://127.0.0.1:4173",
      OIDC_ISSUER: "", OIDC_CLIENT_ID: "",
      ...(clockFile ? { PENNY_LEGACY_CLOCK_FILE: clockFile } : {}),
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const remove = () => rmSync(directory, { recursive: true, force: true });
  const stop = async ({ keep = false } = {}) => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((done) => child.once("exit", done));
    }
    if (!keep) remove();
  };
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url, stop, remove, databasePath };
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  await stop();
  throw new Error(`The legacy server did not start: ${stderr.trim().split("\n").slice(-3).join(" ")}`);
}

// Ledger lists have no stored position: .NET reads them by id (entries by date, id) and
// clients must not depend on their order (docs/migration/ledger.md#storage-mapping-and-read-order).
const unorderedLedgerLists = new Set(["accounts", "trips", "categories", "recurring", "transactions"]);
const instantKeys = new Set(["createdAt", "updatedAt", "joinedAt", "leftAt", "expiresAt", "deletedAt"]);

/** Replaces run-specific values with stable placeholders. */
export function normalize(value, context, key) {
  if (typeof value === "string") {
    let text = value;
    const replacements = [
      ...Object.entries(context.userIds).map(([alias, id]) => [id, `<user:${alias}>`]),
      ...Object.entries(context.households).map(([name, id]) => [id, `<household:${name}>`]),
      ...Object.entries(context.expenseIds).map(([name, id]) => [id, `<expense:${name}>`]),
      ...Object.entries(context.rules ?? {}).map(([name, id]) => [id, `<rule:${name}>`]),
      ...Object.entries(context.users).map(([alias, user]) => [user.email, `<email:${alias}>`]),
      ...Object.entries(context.users).map(([alias, user]) => [user.token, `<token:${alias}>`]),
    ];
    for (const [from, to] of replacements) text = text.split(from).join(to);
    if (/^[0-9a-f]{32}$/.test(text)) return "<generated-id>";
    if (/^[0-9a-f]{64}$/.test(text)) return "<generated-token>";
    if (key === "code" && /^[A-F0-9]{10}$/.test(text)) return "<invite-code>";
    return text;
  }
  if (typeof value === "number" && key && instantKeys.has(key)) return "<instant>";
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item, context));
    if (unorderedLedgerLists.has(key) && items.every((item) => typeof item?.id === "string"))
      return items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Lists keyed by user (splits, balances, members) are ordered by generated user id
    // on both servers; order them by alias so random ids cannot reorder them.
    return items.every((item) => item && typeof item === "object" && typeof item.userId === "string" && item.userId.startsWith("<user:"))
      ? items.sort((a, b) => a.userId.localeCompare(b.userId))
      : items;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, normalize(value[name], context, name)]));
  return value;
}

// Structural differences as JSON-pointer-like paths.
export function differences(left, right, path = "") {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if (left && right && typeof left === "object" && typeof right === "object" && Array.isArray(left) === Array.isArray(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].flatMap((key) => differences(left[key], right[key], `${path}/${key}`));
  }
  return [{ path: path || "/", legacy: left, dotnet: right }];
}

async function probe(apiUrl, context, item) {
  const request = client(apiUrl);
  const token = item.as ? context.users[item.as].token : undefined;
  const { status, body } = await request(item.method, resolve(item.path, context), {
    token, body: item.body === undefined ? undefined : resolve(item.body, context), expect: [200, 201, 400, 401, 403, 404, 409],
  });
  return { status, body: normalize(body, context) };
}

// A registered difference covers its path and everything below it; "*" matches one
// segment (an array index or key), so list positions need not be hard-coded.
export function knownPath(pattern) {
  const source = pattern.split("/").map((part) => part === "*" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
  return new RegExp(`^${source}(?:/|$)`);
}

/**
 * @param {object} state a running .NET environment (environment.mjs)
 * @returns {Promise<{summary: object, differences: string[], results: object[]}>}
 */
export async function compareLegacy(state, { scenario = "differential", legacy } = {}) {
  const definition = findScenario(scenario);
  if (!definition.probes) throw new Error(`Scenario ${scenario} has no probes.`);
  const server = legacy ?? await startLegacy();
  const now = new Date().toISOString();
  try {
    const legacyContext = await seed(definition, { apiUrl: server.url, runTag: `l${state.runId}`, now });
    // Both servers run at real time: a pinned clock would give every write the same
    // instant and let random ids break creation-order ties.
    await control(state, "DELETE", "clock");
    const dotnetContext = await seed(definition, { apiUrl: state.apiUrl, runTag: `d${state.runId}`, now });
    const known = definition.knownDifferences ?? [];
    const results = [];
    const reported = [];
    for (const item of definition.probes) {
      const left = await probe(server.url, legacyContext, item);
      const right = await probe(state.apiUrl, dotnetContext, item);
      const found = differences(left, right).filter((difference) =>
        !known.some((allowed) => allowed.probe === item.name && knownPath(allowed.path).test(difference.path)));
      results.push({ probe: item.name, method: item.method, path: item.path, legacy: left, dotnet: right, differences: found });
      for (const difference of found)
        reported.push(`${item.name} ${difference.path}: legacy ${JSON.stringify(difference.legacy)} vs .NET ${JSON.stringify(difference.dotnet)}`);
    }
    return {
      summary: { scenario, probes: definition.probes.length, matching: results.filter((item) => !item.differences.length).length, knownDifferences: known.length },
      knownDifferences: known,
      differences: reported,
      results,
    };
  } finally {
    if (!legacy) await server.stop();
  }
}

/**
 * Writes the comparison as `parity-report.json` and a readable `parity-report.md` in
 * `directory`, and appends the Markdown to the GitHub job summary when one is set, so a
 * failing CI run shows which probe and field diverged without downloading artifacts.
 * Bodies are already normalized: ids, tokens, emails and instants are placeholders.
 */
export function writeParityReport(report, directory, summaryFile = process.env.GITHUB_STEP_SUMMARY) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "parity-report.json"), JSON.stringify(report, null, 2) + "\n");
  const { summary } = report;
  const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const lines = [
    `## Legacy versus .NET parity (${summary.scenario})`,
    "",
    `${summary.matching}/${summary.probes} probes match; ${summary.knownDifferences} registered differences.`,
    "",
    "| Probe | Request | Legacy | .NET | Result |",
    "| --- | --- | --- | --- | --- |",
    ...report.results.map((item) =>
      `| ${cell(item.probe)} | ${cell(`${item.method} ${item.path}`)} | ${item.legacy.status} | ${item.dotnet.status} | ${item.differences.length ? `**${item.differences.length} differ**` : "match"} |`),
  ];
  if (report.differences.length)
    lines.push("", "### Unregistered differences", "", ...report.differences.map((line) => `- \`${cell(line)}\``),
      "", "Fix the .NET behavior, or, if the change is deliberate, document it and register it in `knownDifferences` (docs/migration/parity-report.md#triage).");
  if (report.knownDifferences?.length)
    lines.push("", "### Registered differences", "", "| Probe | Path | Reason |", "| --- | --- | --- |",
      ...report.knownDifferences.map((item) => `| ${cell(item.probe)} | \`${cell(item.path)}\` | ${cell(item.reason)} |`));
  const markdown = lines.join("\n") + "\n";
  writeFileSync(join(directory, "parity-report.md"), markdown);
  if (summaryFile) appendFileSync(summaryFile, markdown);
  return markdown;
}
