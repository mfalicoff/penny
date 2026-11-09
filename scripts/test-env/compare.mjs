// Legacy-versus-.NET contract comparison (MAZ-62). Runs the `differential` seed scenario
// and its probes against a throwaway legacy Node/SQLite server and a full-stack .NET
// environment, normalizes generated values and reports every difference that is not a
// documented deliberate one. SQLite is used only here, as the legacy reference; v2
// database tests always use PostgreSQL.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { control, freePort, root } from "./environment.mjs";
import { client, resolve, scenario as findScenario, seed } from "./seed.mjs";

/** Starts the legacy server on a temporary SQLite database. */
export async function startLegacy() {
  const directory = mkdtempSync(join(tmpdir(), "penny-legacy-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "server/index.ts"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      HOST: "127.0.0.1", PORT: String(port), DATABASE_PATH: join(directory, "penny.sqlite"),
      ALLOW_REGISTRATION: "true", COOKIE_SECURE: "false", CORS_ORIGINS: "http://127.0.0.1:4173",
      OIDC_ISSUER: "", OIDC_CLIENT_ID: "",
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((done) => child.once("exit", done));
    }
    rmSync(directory, { recursive: true, force: true });
  };
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url, stop };
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
        !known.some((allowed) => allowed.probe === item.name && difference.path.startsWith(allowed.path)));
      results.push({ probe: item.name, legacy: left, dotnet: right, differences: found });
      for (const difference of found)
        reported.push(`${item.name} ${difference.path}: legacy ${JSON.stringify(difference.legacy)} vs .NET ${JSON.stringify(difference.dotnet)}`);
    }
    return {
      summary: { scenario, probes: definition.probes.length, matching: results.filter((item) => !item.differences.length).length, knownDifferences: known.length },
      differences: reported,
      results,
    };
  } finally {
    if (!legacy) await server.stop();
  }
}
