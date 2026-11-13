#!/usr/bin/env node
// Reference Grafana stack smoke test (MAZ-128). Starts deploy/compose.yaml with telemetry on
// and apps/backend/development/observability/compose.yaml next to it, both under throwaway
// project names, then checks that API traces, metrics and logs and client telemetry reach
// Tempo, Prometheus and Loki through Alloy; that the client endpoint refuses foreign origins,
// oversized payloads and API impersonation; and that Grafana provisioned every data source,
// dashboard and alert rule. Everything is synthetic and removed afterwards.
//
//   PENNY_SMOKE_API_IMAGE=localhost/penny-api:dev PENNY_SMOKE_WEB_IMAGE=localhost/penny-web:dev \
//     node scripts/observability-smoke.mjs
//
// PENNY_COMPOSE overrides the compose command (default "docker compose");
// PENNY_SMOKE_KEEP=1 leaves both stacks running after a failure.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dashboards } from "./grafana-dashboards.mjs";
import { deployEnv } from "./test-env/deploy-env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const apiImage = process.env.PENNY_SMOKE_API_IMAGE ?? "localhost/penny-api:dev";
const webImage = process.env.PENNY_SMOKE_WEB_IMAGE ?? "localhost/penny-web:dev";
const composeCommand = (process.env.PENNY_COMPOSE ?? "docker compose").split(" ");
const id = randomBytes(4).toString("hex");
const appProject = `penny-otel-smoke-${id}`;
const observabilityProject = `penny-otel-smoke-${id}-grafana`;
const directory = path.join(root, ".cache", "observability-smoke", id);
const observabilityCompose = path.join(root, "apps/backend/development/observability/compose.yaml");

const ALERT_RULES = 8;
let failures = 0;

function check(condition, description, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "ok" : "not ok"} - ${description}${!condition && detail ? ` (${detail})` : ""}`);
  return condition;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function compose(project, files, envFile, args, { allowFailure = false } = {}) {
  const [command, ...prefix] = composeCommand;
  const result = spawnSync(command, [...prefix, "-p", project, ...files.flatMap((file) => ["-f", file]), "--env-file", envFile, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) throw new Error(`compose ${args.join(" ")} failed (${result.status}): ${result.stderr.slice(-2000)}`);
  return result;
}

async function waitFor(description, probe, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await probe();
      if (last) return check(true, description);
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return check(false, description, typeof last === "string" ? last : "timed out");
}

async function main() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const [webPort, grafanaPort, otlpPort, faroPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  const origin = `http://localhost:${webPort}`;
  const grafana = `http://127.0.0.1:${grafanaPort}`;
  const grafanaPassword = randomBytes(18).toString("hex");
  const subnet = `172.31.${64 + (randomBytes(1)[0] % 180)}.0/24`;

  // The application stack, with the API exporting to the observability stack's Alloy.
  const appEnv = path.join(directory, "app.env");
  writeFileSync(appEnv, deployEnv(origin, { PENNY_API_IMAGE: apiImage, PENNY_WEB_IMAGE: webImage, PENNY_PORT: webPort, PENNY_SUBNET: subnet }), { mode: 0o600 });
  const telemetry = path.join(directory, "telemetry.yaml");
  writeFileSync(
    telemetry,
    [
      "services:",
      "  api:",
      "    environment:",
      "      OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy:4317",
      "      OTEL_RESOURCE_ATTRIBUTES: deployment.environment.name=smoke",
      '      OTEL_METRIC_EXPORT_INTERVAL: "5000"',
      '      OTEL_BSP_SCHEDULE_DELAY: "1000"',
      '      OTEL_BLRP_SCHEDULE_DELAY: "1000"',
      "",
    ].join("\n"),
  );
  const app = (args, options) => compose(appProject, [path.join(root, "deploy/compose.yaml"), telemetry], appEnv, args, options);

  const observabilityEnv = path.join(directory, "observability.env");
  writeFileSync(
    observabilityEnv,
    Object.entries({
      GRAFANA_ADMIN_PASSWORD: grafanaPassword,
      GRAFANA_PORT: grafanaPort,
      PENNY_OTLP_CLIENT_PORT: otlpPort,
      PENNY_FARO_PORT: faroPort,
      PENNY_TELEMETRY_ORIGINS: origin,
      PENNY_NETWORK: `${appProject}_penny`,
    })
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
    { mode: 0o600 },
  );
  const observability = (args, options) => compose(observabilityProject, [observabilityCompose], observabilityEnv, args, options);

  const cleanup = () => {
    observability(["down", "-v", "--remove-orphans"], { allowFailure: true });
    app(["down", "-v", "--remove-orphans"], { allowFailure: true });
    rmSync(directory, { recursive: true, force: true });
  };

  let passed = false;
  try {
    console.log(`# ${appProject} on ${origin}, Grafana on ${grafana} (api ${apiImage})`);
    // Penny first: it creates the network Alloy joins.
    app(["up", "-d", "--wait", "--no-build", "--pull", "never"]);
    check(true, "Penny stack started");
    observability(["up", "-d", "--wait"]);
    check(true, "observability stack started; Grafana and Prometheus healthy");

    const published = (service) =>
      observability(["ps", "--format", "json", service])
        .stdout.trim()
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => [JSON.parse(line)].flat())
        .flatMap((container) => container.Publishers ?? [])
        .filter((publisher) => publisher.PublishedPort > 0);
    // `--wait` only covers services with a health check; Loki, Tempo and Alloy images have no
    // shell or HTTP client for one, so a crash loop would otherwise go unnoticed.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const states = observability(["ps", "--all", "--format", "json"])
      .stdout.trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => [JSON.parse(line)].flat())
      .map((container) => `${container.Service}=${container.State}`)
      .sort();
    check(
      states.length === 5 && states.every((state) => state.endsWith("=running")),
      "all five observability containers are running",
      states.join(" "),
    );
    const alloyPorts = published("alloy")
      .map((publisher) => publisher.TargetPort)
      .sort((a, b) => a - b);
    check(JSON.stringify(alloyPorts) === "[4319,12347]", "Alloy publishes only the client ingest ports", JSON.stringify(alloyPorts));
    check(published("alloy").every((publisher) => publisher.URL === "127.0.0.1"), "client ingest is published on loopback only");
    check(["loki", "tempo", "prometheus"].every((service) => published(service).length === 0), "Loki, Tempo and Prometheus are not published");

    const auth = `Basic ${Buffer.from(`admin:${grafanaPassword}`).toString("base64")}`;
    const grafanaApi = async (pathname) => {
      const response = await fetch(grafana + pathname, { headers: { authorization: auth } });
      if (!response.ok) throw new Error(`${pathname}: ${response.status}`);
      return response.json();
    };
    const anonymous = await fetch(`${grafana}/api/search`);
    check(anonymous.status === 401, "Grafana requires sign-in", String(anonymous.status));

    // API traffic: a failed sign-in and authenticated reads. nginx sets each request id and the
    // API returns it, which is what a user would report.
    const ready = await fetch(`${origin}/api/ready`);
    check(ready.status === 200, "API ready");
    const email = `smoke-${id}@example.test`;
    const password = `smoke password ${id}`;
    const json = { "content-type": "application/json", origin };
    const registered = await fetch(`${origin}/api/auth/register`, { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
    const token = (await registered.json()).token;
    await fetch(`${origin}/api/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ email, password: "wrong password!" }) });
    let ledgerRequestId = "";
    for (let i = 0; i < 5; i += 1) {
      const ledger = await fetch(`${origin}/api/ledger`, { headers: { authorization: `Bearer ${token}` } });
      ledgerRequestId ||= ledger.headers.get("x-request-id") ?? "";
    }
    check(/^[0-9a-f]{32}$/.test(ledgerRequestId), "API returned the request id");

    // Client telemetry through the public ingest endpoint. Alloy has no health check (its
    // image has no HTTP client), so wait for the receiver itself.
    const ingest = `http://127.0.0.1:${otlpPort}`;
    await waitFor("Alloy client ingest is listening", async () => (await fetch(`${ingest}/v1/logs`, { method: "OPTIONS" })).status < 500, 60_000);
    const now = `${Date.now()}000000`;
    const traceId = randomBytes(16).toString("hex");
    const clientLog = (service, message, severity = 17) =>
      JSON.stringify({
        resourceLogs: [
          {
            resource: { attributes: [{ key: "service.name", value: { stringValue: service } }, { key: "service.version", value: { stringValue: "0.0.0-smoke" } }] },
            scopeLogs: [
              {
                scope: { name: "penny.smoke" },
                logRecords: [
                  {
                    timeUnixNano: now,
                    severityNumber: severity,
                    body: { stringValue: message },
                    traceId,
                    spanId: randomBytes(8).toString("hex"),
                    attributes: [{ key: "exception.type", value: { stringValue: "SmokeError" } }],
                  },
                ],
              },
            ],
          },
        ],
      });
    const post = (body, headers = {}) => fetch(`${ingest}/v1/logs`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    const accepted = await post(clientLog("penny-web", `client error ${id}`), { origin });
    check(accepted.status === 200, "client ingest accepts a penny-web error", String(accepted.status));
    await post(clientLog("penny-ios", `client crash ${id}`, 21));
    await post(clientLog("penny-backend", `impersonation ${id}`));
    const preflight = (from) => fetch(`${ingest}/v1/logs`, { method: "OPTIONS", headers: { origin: from, "access-control-request-method": "POST" } });
    check((await preflight(origin)).headers.get("access-control-allow-origin") === origin, "client ingest allows the Penny origin");
    check((await preflight("https://attacker.example")).headers.get("access-control-allow-origin") === null, "client ingest refuses a foreign origin");
    // Alloy may answer 400 or close the connection before reading the whole body.
    const oversized = await post("x".repeat(2 * 1024 * 1024)).then(
      (response) => response.status,
      (error) => error.cause?.code ?? error.message,
    );
    check(oversized === 400 || oversized === 413 || oversized === "ECONNRESET" || oversized === "EPIPE", "client ingest refuses payloads over 1 MiB", String(oversized));

    // Everything is read back through Grafana's data source proxy, as an operator would.
    const prometheus = (query) => grafanaApi(`/api/datasources/proxy/uid/prometheus/api/v1/query?${new URLSearchParams({ query })}`).then((r) => r.data.result);
    const loki = (query) =>
      grafanaApi(`/api/datasources/proxy/uid/loki/loki/api/v1/query_range?${new URLSearchParams({ query, start: `${Date.now() - 15 * 60_000}000000`, limit: "20" })}`).then((r) =>
        r.data.result.flatMap((stream) => stream.values.map(([, line]) => line)),
      );
    const tempo = (q) => grafanaApi(`/api/datasources/proxy/uid/tempo/api/search?${new URLSearchParams({ q, limit: "5" })}`).then((r) => r.traces ?? []);

    await waitFor("Prometheus has API request metrics", async () => (await prometheus('http_server_request_duration_seconds_count{job="penny-backend", http_route="api/ledger"}')).length > 0);
    await waitFor("Prometheus has the sign-in failure", async () => (await prometheus('penny_auth_sign_ins_total{job="penny-backend", penny_outcome="failure"}')).length > 0);
    await waitFor("Prometheus has the environment label", async () => (await prometheus('target_info{job="penny-backend", deployment_environment_name="smoke"}')).length > 0);
    await waitFor("Loki has API logs for the request id", async () => (await loki(`{service_name="penny-backend"} | RequestId = "${ledgerRequestId}"`)).length > 0);
    await waitFor("Tempo has the API trace for the request id", async () => (await tempo(`{ span.penny.request_id = "${ledgerRequestId}" }`)).length > 0);
    await waitFor("Tempo has the request's PostgreSQL spans", async () => (await tempo(`{ span.penny.request_id = "${ledgerRequestId}" } >> { span.db.system.name = "postgresql" }`)).length > 0);
    await waitFor("Loki has the client error and crash", async () => (await loki(`{service_name=~"penny-web|penny-ios"} |~ "client (error|crash) ${id}"`)).length === 2);
    check((await loki(`{service_name="penny-backend"} |= "impersonation ${id}"`)).length === 0, "client ingest dropped the record claiming to be penny-backend");

    // Provisioning: data sources, every generated dashboard and the alert rules.
    const datasources = (await grafanaApi("/api/datasources")).map((source) => source.uid).sort();
    check(JSON.stringify(datasources) === '["loki","prometheus","tempo"]', "Grafana provisioned the three data sources", JSON.stringify(datasources));
    const provisioned = (await grafanaApi("/api/search?type=dash-db")).map((board) => board.uid).sort();
    const expected = Object.values(dashboards)
      .map((build) => build().uid)
      .sort();
    check(JSON.stringify(provisioned) === JSON.stringify(expected), "Grafana provisioned every dashboard", JSON.stringify(provisioned));
    const rules = await grafanaApi("/api/v1/provisioning/alert-rules");
    check(rules.length === ALERT_RULES, `Grafana provisioned ${ALERT_RULES} alert rules`, String(rules.length));
    await waitFor(
      "every alert rule evaluates without errors",
      async () => {
        const groups = (await grafanaApi("/api/prometheus/grafana/api/v1/rules")).data.groups;
        const evaluated = groups.flatMap((group) => group.rules).filter((rule) => rule.lastEvaluation && !rule.lastEvaluation.startsWith("0001"));
        const broken = evaluated.filter((rule) => rule.health !== "ok");
        if (broken.length) throw new Error(broken.map((rule) => `${rule.name}: ${rule.lastError}`).join("; "));
        return evaluated.length === ALERT_RULES;
      },
      420_000,
    );
    const crashes = (await grafanaApi("/api/prometheus/grafana/api/v1/rules")).data.groups.flatMap((group) => group.rules).find((rule) => rule.name === "Penny app crashes");
    check(crashes?.state === "firing", "the app crash alert fires for the synthetic crash", crashes?.state);

    passed = failures === 0;
  } finally {
    if (!passed && process.env.PENNY_SMOKE_KEEP === "1") console.log(`# kept ${appProject} and ${observabilityProject}; settings in ${directory}`);
    else cleanup();
  }
  console.log(failures ? `# ${failures} check(s) failed` : "# all checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
