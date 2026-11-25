/**
 * Ledger sync baseline (MAZ-186 step 1): payload sizes and times of today's whole-document sync,
 * measured against a full-stack test environment (`scripts/test-env`, the real .NET API on
 * PostgreSQL). Method and results: docs/reference/ledger-sync-baseline.md.
 *
 *   node scripts/test-env/penny-env.mjs up            # from the repository root
 *   npm --prefix apps/web run bench:ledger-sync -- [--sizes 2000,50000] [--runs 15] [--json out.json]
 *
 * Synthetic ledgers only (scripts/ledger-bench/synthetic.ts); nothing real is read or written.
 */
import { readFileSync, statSync, openSync, readSync, closeSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Agent, request as httpsRequest } from "node:https";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from "node:zlib";
import type { Ledger } from "../src/domain/ledger.ts";
import { registerViteLikeResolution } from "./ledger-bench/hooks.ts";
import { editEntry, summarize, syntheticLedger, type Summary } from "./ledger-bench/synthetic.ts";

registerViteLikeResolution();
const { LedgerSyncEngine } = await import("../src/offline/engine.ts");
const { MemoryLedgerDatabase } = await import("../src/offline/database.ts");
const { parseLedger } = await import("../src/offline/wire.ts");
type ServerSnapshot = import("../src/offline/wire.ts").ServerSnapshot;

const TODAY = "2026-11-25";
const { values: args } = parseArgs({
  options: {
    sizes: { type: "string", default: "2000,50000" },
    runs: { type: "string", default: "15" },
    json: { type: "string" },
  },
});
const sizes = args.sizes.split(",").map(Number);
const runs = Number(args.runs);
if (sizes.some((n) => !Number.isInteger(n) || n < 1) || !Number.isInteger(runs) || runs < 1) throw new Error("--sizes and --runs take positive integers");

// The environment this checkout started last, or PENNY_TEST_RUN.
const root = new URL("../../../", import.meta.url);
const runId = process.env.PENNY_TEST_RUN ?? readFileSync(new URL(".cache/test-env/current", root), "utf8").trim();
const state = JSON.parse(readFileSync(new URL(`.cache/test-env/${runId}/env.json`, root), "utf8")) as { apiUrl: string; controlToken: string; apiLog: string; tls?: { certificate?: string } };
const certificate = state.tls?.certificate ?? new URL(`.cache/test-env/${runId}/tls/certificate.pem`, root).pathname;
// Trust exactly this run's certificate (Node 24.5+), as the test-env runner does.
(await import("node:tls")).setDefaultCACertificates([readFileSync(certificate, "utf8")]);

/** Raw, gzip (level 6) and Brotli (quality 4, a typical on-the-fly level) sizes of a body. */
function sizesOf(text: string) {
  const bytes = Buffer.from(text);
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 6 }).length,
    br: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length,
  };
}

/** The API's own request time (`RequestCorrelationMiddleware`: "HTTP PUT api/ledger responded 200 in 12.3 ms"), read from its log. */
class ServerLog {
  private offset = statSync(state.apiLog).size;
  private buffer = "";

  async next(count: number): Promise<Array<{ method: string; ms: number }>> {
    const found: Array<{ method: string; ms: number }> = [];
    const deadline = Date.now() + 10_000;
    while (found.length < count) {
      const size = statSync(state.apiLog).size;
      if (size > this.offset) {
        const chunk = Buffer.alloc(size - this.offset);
        const fd = openSync(state.apiLog, "r");
        readSync(fd, chunk, 0, chunk.length, this.offset);
        closeSync(fd);
        this.offset = size;
        this.buffer += chunk.toString("utf8");
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
          const match = /HTTP (GET|PUT) api\/ledger responded (\d+) in ([\d.]+) ms/.exec(line);
          if (match) found.push({ method: match[1] as string, ms: Number(match[3]) });
        }
      } else if (Date.now() > deadline) {
        throw new Error(`Expected ${count} ledger requests in the API log, found ${found.length}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (found.length > count) throw new Error(`Expected ${count} ledger requests in the API log, found ${found.length}`);
    return found;
  }
}

async function testUser(label: string): Promise<string> {
  const response = await fetch(`${state.apiUrl}/api/test/users`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-penny-test-token": state.controlToken },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new Error(`POST /api/test/users: ${response.status}`);
  return ((await response.json()) as { token: string }).token;
}

interface Exchange {
  method: "GET" | "PUT";
  status: number;
  request: string;
  response: string;
  contentEncoding: string | null;
  /** The response body's size on the wire, as served (compressed or not). */
  wireBytes: number;
  /** Request until the whole body is read and decoded, on loopback. */
  roundTripMs: number;
}

// `fetch` decodes compressed bodies without saying how big they were, so requests go through
// node:https, which hands over the bytes as served. One kept-alive connection, as a browser has.
const agent = new Agent({ keepAlive: true, maxSockets: 1 });

async function exchange(token: string, method: "GET" | "PUT", body?: unknown): Promise<Exchange> {
  const request = body === undefined ? "" : JSON.stringify(body);
  const payload = Buffer.from(request);
  const started = performance.now();
  const { status, encoding, wire } = await new Promise<{ status: number; encoding: string | null; wire: Buffer }>((resolve, reject) => {
    const call = httpsRequest(
      new URL("/api/ledger", state.apiUrl),
      {
        method,
        agent,
        headers: { authorization: `Bearer ${token}`, "accept-encoding": "gzip, br", ...(body === undefined ? {} : { "content-type": "application/json", "content-length": payload.length }) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const header = response.headers["content-encoding"];
          resolve({ status: response.statusCode ?? 0, encoding: typeof header === "string" ? header : null, wire: Buffer.concat(chunks) });
        });
      },
    );
    call.on("error", reject);
    call.end(body === undefined ? undefined : payload);
  });
  const decoded = encoding === "br" ? brotliDecompressSync(wire) : encoding === "gzip" ? gunzipSync(wire) : wire;
  return { method, status, request, response: decoded.toString("utf8"), contentEncoding: encoding, wireBytes: wire.length, roundTripMs: performance.now() - started };
}

/** One device's view of the wire, for the engine: every exchange, and the time spent parsing answers. */
function engineApi(token: string, network: { online: boolean }) {
  const log: Exchange[] = [];
  let parseMs = 0;
  const answer = (item: Exchange): ServerSnapshot => {
    log.push(item);
    if (item.status !== 200) throw new Error(`${item.method} /api/ledger: ${item.status} ${item.response.slice(0, 200)}`);
    const started = performance.now();
    const raw = JSON.parse(item.response) as { revision: number; ledger: unknown };
    const snapshot = { revision: raw.revision, ledger: parseLedger(raw.ledger) };
    parseMs += performance.now() - started;
    return snapshot;
  };
  // Offline, requests fail as `fetch` does without a network, so a save stays pending.
  const online = () => {
    if (!network.online) throw new TypeError("Failed to fetch");
  };
  return {
    log,
    takeParseMs: () => {
      const value = parseMs;
      parseMs = 0;
      return value;
    },
    api: {
      get: async () => {
        online();
        return answer(await exchange(token, "GET"));
      },
      put: async (snapshot: ServerSnapshot) => {
        online();
        return answer(await exchange(token, "PUT", snapshot));
      },
    },
  };
}

interface Row {
  scenario: string;
  entries: number;
  requests: string;
  requestBytes: { raw: number; gzip: number; br: number };
  responseBytes: { raw: number; gzip: number; br: number };
  contentEncoding: string;
  servedResponseBytes: number;
  serverMs: Summary;
  roundTripMs: Summary;
  clientParseMs?: Summary;
  clientEngineMs?: Summary;
  passMs?: Summary;
}

const total = (items: Exchange[], side: "request" | "response") => {
  const all = items.map((item) => sizesOf(item[side]));
  return { raw: all.reduce((sum, s) => sum + s.raw, 0), gzip: all.reduce((sum, s) => sum + s.gzip, 0), br: all.reduce((sum, s) => sum + s.br, 0) };
};

async function measure(entries: number): Promise<Row[]> {
  const serverLog = new ServerLog();
  const rows: Row[] = [];
  const ledger = syntheticLedger({ entries, today: TODAY });

  // One account. Device B makes the "remote" changes over raw HTTP; device A (below) is the web engine.
  const tokenA = await testUser(`bench-${entries}`);
  const tokenB = tokenA;
  const first = await exchange(tokenB, "GET");
  const upload = await exchange(tokenB, "PUT", { revision: (JSON.parse(first.response) as { revision: number }).revision, ledger });
  if (upload.status !== 200) throw new Error(`Seeding ${entries} entries: ${upload.status} ${upload.response.slice(0, 300)}`);
  await serverLog.next(2);
  let remote = JSON.parse(upload.response) as { revision: number; ledger: Ledger };

  const record = async (scenario: string, requests: string, once: (round: number) => Promise<Exchange[]>, warmups = 2) => {
    for (let round = 0; round < warmups; round += 1) {
      const items = await once(-1 - round);
      await serverLog.next(items.length);
    }
    const server: number[] = [];
    const roundTrip: number[] = [];
    let last: Exchange[] = [];
    for (let round = 0; round < runs; round += 1) {
      last = await once(round);
      const times = await serverLog.next(last.length);
      server.push(times.reduce((sum, item) => sum + item.ms, 0));
      roundTrip.push(last.reduce((sum, item) => sum + item.roundTripMs, 0));
    }
    rows.push({
      scenario, entries, requests, requestBytes: total(last, "request"), responseBytes: total(last, "response"),
      contentEncoding: last.map((item) => item.contentEncoding ?? "identity").join(", "), servedResponseBytes: last.reduce((sum, item) => sum + item.wireBytes, 0), serverMs: summarize(server), roundTripMs: summarize(roundTrip),
    });
  };

  // GET /api/ledger.
  await record("GET /api/ledger", "GET", async () => [await exchange(tokenB, "GET")]);

  // PUT /api/ledger with one changed entry (the whole document, based on the current revision).
  let edits = 0;
  await record("PUT /api/ledger, one entry changed", "PUT", async () => {
    const sent = { revision: remote.revision, ledger: editEntry(remote.ledger, 7, edits++) };
    const item = await exchange(tokenB, "PUT", sent);
    if (item.status !== 200) throw new Error(`PUT: ${item.status} ${item.response.slice(0, 300)}`);
    remote = JSON.parse(item.response) as { revision: number; ledger: Ledger };
    return [item];
  });

  // Device A: the web client's sync engine (src/offline/engine.ts) with an in-memory store.
  const network = { online: true };
  const a = engineApi(tokenA, network);
  const engine = new LedgerSyncEngine({
    server: "https://bench.penny.test",
    email: "bench@penny.test",
    api: a.api,
    openDatabase: () => Promise.resolve(new MemoryLedgerDatabase()),
    online: () => network.online,
    visible: () => true,
    today: () => TODAY,
    now: () => new Date(`${TODAY}T12:00:00Z`),
    sleep: () => Promise.resolve(),
    random: () => 0,
    lock: (_name, task) => task(),
    channel: () => ({ post: () => undefined, close: () => undefined }),
    events: null,
    requestPersistence: () => undefined,
  });
  engine.start();
  await engine.sync();
  if (engine.getState().phase !== "upToDate") throw new Error(`Engine did not load: ${JSON.stringify(engine.getState().issue)}`);
  await serverLog.next(a.log.length);
  a.log.length = 0;
  a.takeParseMs();

  const pass = async (scenario: string, prepare: (round: number) => Promise<number>) => {
    const server: number[] = [];
    const roundTrip: number[] = [];
    const parse: number[] = [];
    const engineWork: number[] = [];
    const wall: number[] = [];
    let last: Exchange[] = [];
    for (let round = -2; round < runs; round += 1) {
      const prepared = await prepare(round);
      if (prepared) await serverLog.next(prepared);
      a.log.length = 0;
      a.takeParseMs();
      network.online = true;
      const started = performance.now();
      await engine.sync();
      const elapsed = performance.now() - started;
      const state = engine.getState();
      if (state.phase !== "upToDate") throw new Error(`${scenario}: ${state.phase} ${JSON.stringify(state.issue)}`);
      const times = await serverLog.next(a.log.length);
      const networkMs = a.log.reduce((sum, item) => sum + item.roundTripMs, 0);
      const parseMs = a.takeParseMs();
      if (round < 0) continue;
      last = [...a.log];
      server.push(times.reduce((sum, item) => sum + item.ms, 0));
      roundTrip.push(networkMs);
      parse.push(parseMs);
      engineWork.push(elapsed - networkMs - parseMs);
      wall.push(elapsed);
    }
    rows.push({
      scenario, entries, requests: last.map((item) => item.method).join(" + "), requestBytes: total(last, "request"), responseBytes: total(last, "response"),
      contentEncoding: last.map((item) => item.contentEncoding ?? "identity").join(", "), servedResponseBytes: last.reduce((sum, item) => sum + item.wireBytes, 0),
      serverMs: summarize(server), roundTripMs: summarize(roundTrip), clientParseMs: summarize(parse), clientEngineMs: summarize(engineWork), passMs: summarize(wall),
    });
  };

  const remoteEdit = async (round: number) => {
    const current = await exchange(tokenB, "GET");
    const snapshot = JSON.parse(current.response) as { revision: number; ledger: Ledger };
    const item = await exchange(tokenB, "PUT", { revision: snapshot.revision, ledger: editEntry(snapshot.ledger, 11, 1000 + round) });
    if (item.status !== 200) throw new Error(`Remote edit: ${item.status}`);
    return 2;
  };

  await pass("Web sync pass, no change", () => Promise.resolve(0));
  await pass("Web sync pass, one remote change", remoteEdit);
  await pass("Web sync pass, one remote and one local change (merge + PUT)", async (round) => {
    const prepared = await remoteEdit(round);
    // Saved while offline, so it is pending when the measured pass starts.
    network.online = false;
    await engine.save((value) => editEntry(value, 3, 2000 + round));
    // The sync the save started fails offline; wait for it, so the measured pass is the only one.
    await engine.sync();
    if (!engine.getState().issue) throw new Error("Expected the local change to wait while offline");
    return prepared;
  });
  engine.stop();
  return rows;
}

/**
 * A freshly started API is still compiling (JIT, EF query plans): its first saves take several times
 * longer. Warm it up on a separate account before anything is measured.
 */
async function warmUp() {
  const token = await testUser("bench-warm-up");
  let snapshot = JSON.parse((await exchange(token, "GET")).response) as { revision: number; ledger: Ledger };
  snapshot.ledger = syntheticLedger({ entries: 2000, seed: 7, today: TODAY });
  for (let round = 0; round < 30; round += 1) {
    const item = await exchange(token, "PUT", { revision: snapshot.revision, ledger: editEntry(snapshot.ledger, round, round) });
    if (item.status !== 200) throw new Error(`Warm-up PUT: ${item.status}`);
    snapshot = JSON.parse(item.response) as { revision: number; ledger: Ledger };
    await exchange(token, "GET");
  }
}

process.stderr.write("Warming up the API…\n");
await warmUp();
const results: Row[] = [];
for (const entries of sizes) {
  process.stderr.write(`Measuring ${entries} entries, ${runs} runs each…\n`);
  results.push(...(await measure(entries)));
}

const kib = (bytes: number) => (bytes < 10_240 ? `${(bytes / 1024).toFixed(1)} KiB` : bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1_048_576).toFixed(2)} MiB`);
const ms = (value?: Summary) => (value ? `${value.median.toFixed(1)} (p90 ${value.p90.toFixed(1)})` : "–");
const sizeCell = (value: { raw: number; gzip: number; br: number }) => (value.raw === 0 ? "0" : `${kib(value.raw)} / ${kib(value.gzip)} / ${kib(value.br)}`);
const lines = [
  `Runs per scenario: ${runs} (after 2 warm-ups). Times in ms, median (p90). Sizes raw / gzip (level 6) / br (quality 4); "Served response" is what came over the wire.`,
  "",
  "| Entries | Scenario | Requests | Request bytes | Response bytes | Served response | Server ms | Round trip ms | Web parse ms | Web engine ms | Web pass ms |",
  "| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...results.map((row) => `| ${row.entries.toLocaleString("en")} | ${row.scenario} | ${row.requests} | ${sizeCell(row.requestBytes)} | ${sizeCell(row.responseBytes)} | ${kib(row.servedResponseBytes)} (${row.contentEncoding}) | ${ms(row.serverMs)} | ${ms(row.roundTripMs)} | ${ms(row.clientParseMs)} | ${ms(row.clientEngineMs)} | ${ms(row.passMs)} |`),
];
process.stdout.write(`${lines.join("\n")}\n`);
if (args.json) writeFileSync(args.json, `${JSON.stringify({ today: TODAY, runs, node: process.version, results }, null, 2)}\n`);
agent.destroy();
