#!/usr/bin/env node
// Generates Penny's Grafana dashboards (MAZ-128) into
// apps/backend/development/observability/grafana/dashboards/. Edit this file, not the JSON:
//
//   npm run dashboards:generate   # rewrite the JSON files
//   npm run dashboards:check      # fail when the JSON files differ from this script
//
// Metric names are what Prometheus stores for the API's OpenTelemetry instruments
// (docs/operations.md#what-each-signal-contains) after OTLP translation: dots become
// underscores, counters gain `_total`, and units become suffixes (`_seconds`, `_bytes`).
// Every dashboard picks its data sources from variables, so it imports into a Grafana whose
// Prometheus, Loki and Tempo have other names.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const dashboardDirectory = path.join(root, "apps/backend/development/observability/grafana/dashboards");

const PROM = { type: "prometheus", uid: "${prometheus}" };
const LOKI = { type: "loki", uid: "${loki}" };
const TEMPO = { type: "tempo", uid: "${tempo}" };

// Every API selector carries these filters.
const F = 'job="$service", instance=~"$instance", deployment_environment_name=~"$environment"';
// Container health checks hit /api/health and /api/ready constantly; traffic panels skip them.
const APP = `${F}, http_route!~"api/(health|ready)"`;
const LSEL = '{service_name="$service", service_instance_id=~"$instance", deployment_environment_name=~"$environment"}';
const CLIENTS = "penny-web|penny-ios";

const histogram = (p, metric, by = "le", sel = APP, window = "$__rate_interval") =>
  `histogram_quantile(${p}, sum by (${by}) (rate(${metric}_bucket{${sel}}[${window}])))`;

const red = (pattern) => ({ matcher: { id: "byRegexp", options: pattern }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "red" } }] });
const fixed = (name, color) => ({ matcher: { id: "byName", options: name }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: color } }] });
const thresholds = (...steps) => ({ mode: "absolute", steps: steps.map(([color, value]) => ({ color, value })) });

// Lays panels out left to right in rows of 24 columns.
class Board {
  constructor() {
    this.panels = [];
    this.id = 0;
    this.x = 0;
    this.y = 0;
    this.rowHeight = 0;
  }

  place(w, h) {
    if (this.x + w > 24) this.newline();
    const pos = { h, w, x: this.x, y: this.y };
    this.x += w;
    this.rowHeight = Math.max(this.rowHeight, h);
    return pos;
  }

  newline() {
    this.y += this.rowHeight;
    this.x = 0;
    this.rowHeight = 0;
  }

  add(panel, w, h) {
    this.panels.push({ id: ++this.id, gridPos: this.place(w, h), ...panel });
    return this;
  }

  row(title) {
    this.newline();
    this.panels.push({ type: "row", id: ++this.id, title, collapsed: false, gridPos: { h: 1, w: 24, x: 0, y: this.y }, panels: [] });
    this.y += 1;
    return this;
  }

  text(content, w = 24, h = 3) {
    return this.add({ type: "text", title: "", options: { mode: "markdown", content } }, w, h);
  }

  stat(title, w, expr, { unit = "short", decimals, steps = [["green", null]], description, graph = "area", noValue = "0", datasource = PROM, h = 4 } = {}) {
    const target = datasource === LOKI ? { datasource, refId: "A", expr, queryType: "instant" } : { datasource, refId: "A", expr, range: true, legendFormat: "" };
    return this.add(
      {
        type: "stat",
        title,
        description,
        datasource,
        targets: [target],
        fieldConfig: { defaults: { unit, decimals, noValue, mappings: [], color: { mode: "thresholds" }, thresholds: thresholds(...steps) }, overrides: [] },
        options: { colorMode: "value", graphMode: graph, justifyMode: "auto", textMode: "auto", reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false } },
      },
      w,
      h,
    );
  }

  // queries: [expr, legend] pairs.
  series(title, w, h, queries, { unit = "short", stack = false, bars = false, description, overrides = [], calcs = ["mean", "max"], datasource = PROM, min = 0 } = {}) {
    const targets = queries.map(([expr, legendFormat], i) =>
      datasource === LOKI ? { datasource, refId: ref(i), expr, legendFormat, queryType: "range" } : { datasource, refId: ref(i), expr, legendFormat, range: true },
    );
    return this.add(
      {
        type: "timeseries",
        title,
        description,
        datasource,
        ...(bars ? { interval: "1m" } : {}),
        targets,
        fieldConfig: {
          defaults: {
            unit,
            min,
            color: { mode: "palette-classic" },
            custom: {
              drawStyle: bars ? "bars" : "line",
              lineWidth: 1,
              fillOpacity: stack || bars ? 60 : 10,
              gradientMode: "none",
              showPoints: "never",
              spanNulls: true,
              stacking: { mode: stack ? "normal" : "none", group: "A" },
            },
          },
          overrides,
        },
        options: {
          legend: { displayMode: "table", placement: "bottom", calcs: bars ? ["sum"] : calcs, showLegend: true },
          tooltip: { mode: "multi", sort: "desc" },
        },
      },
      w,
      h,
    );
  }

  // Counts per interval as stacked bars.
  counts(title, w, h, queries, options = {}) {
    return this.series(title, w, h, queries, { ...options, bars: true, stack: true });
  }

  // columns: [instant expr, column name] pairs merged on their labels.
  table(title, w, h, columns, { description, overrides = [], sortBy = [], datasource = PROM } = {}) {
    return this.add(
      {
        type: "table",
        title,
        description,
        datasource,
        targets: columns.map(([expr], i) =>
          datasource === LOKI
            ? { datasource, refId: ref(i), expr, queryType: "instant", legendFormat: "" }
            : { datasource, refId: ref(i), expr, instant: true, range: false, format: "table", legendFormat: "" },
        ),
        transformations: [
          { id: "merge", options: {} },
          {
            id: "organize",
            options: {
              excludeByName: { Time: true },
              // A single query names its column Value (Prometheus) or Value #A (Loki).
              renameByName: Object.fromEntries(columns.flatMap(([, name], i) => [[`Value #${ref(i)}`, name], ...(columns.length === 1 ? [["Value", name]] : [])])),
            },
          },
        ],
        fieldConfig: { defaults: { custom: { align: "auto", cellOptions: { type: "auto" } } }, overrides },
        options: { showHeader: true, cellHeight: "sm", sortBy },
      },
      w,
      h,
    );
  }

  logs(title, w, h, expr, description) {
    return this.add(
      {
        type: "logs",
        title,
        description,
        datasource: LOKI,
        targets: [{ datasource: LOKI, refId: "A", expr, queryType: "range" }],
        options: { showTime: true, wrapLogMessage: true, sortOrder: "Descending", enableLogDetails: true, dedupStrategy: "none", prettifyLogMessage: false },
      },
      w,
      h,
    );
  }

  traces(title, w, h, query, description) {
    return this.add(
      {
        type: "table",
        title,
        description,
        datasource: TEMPO,
        targets: [{ datasource: TEMPO, refId: "A", queryType: "traceql", query, limit: 25, tableType: "traces" }],
        fieldConfig: { defaults: { custom: { align: "auto" } }, overrides: [] },
        options: { showHeader: true, cellHeight: "sm" },
      },
      w,
      h,
    );
  }

  logVolume(title, w, h, expr, legend = "{{detected_level}}") {
    return this.series(title, w, h, [[expr, legend]], {
      datasource: LOKI,
      bars: true,
      stack: true,
      overrides: [fixed("Information", "green"), fixed("Warning", "orange"), fixed("Error", "red"), fixed("Critical", "dark-red"), fixed("Debug", "blue")],
    });
  }
}

const ref = (i) => String.fromCharCode(65 + i);

// --- Variables ------------------------------------------------------------------------------

const datasourceVariable = (name, type, label) => ({
  name,
  label,
  type: "datasource",
  query: type,
  current: { text: name, value: name },
  hide: 0,
  refresh: 1,
  regex: "",
  includeAll: false,
  multi: false,
  options: [],
});

const queryVariable = (name, label, query, { all = false, multi = false, current } = {}) => ({
  name,
  label,
  type: "query",
  datasource: PROM,
  query: { query, refId: name },
  definition: query,
  current: current ?? (all ? { text: "All", value: "$__all" } : {}),
  refresh: 2,
  sort: 1,
  includeAll: all,
  ...(all ? { allValue: ".*" } : {}),
  multi,
  hide: 0,
  options: [],
});

const customVariable = (name, label, values, current) => ({
  name,
  label,
  type: "custom",
  query: values.join(","),
  current: { text: current, value: current },
  options: values.map((value) => ({ text: value, value, selected: value === current })),
  hide: 0,
  includeAll: false,
  multi: false,
});

const textVariable = (name, label) => ({ name, label, type: "textbox", query: "", current: { text: "", value: "" }, hide: 0 });

const apiVariables = (...extra) => [
  datasourceVariable("prometheus", "prometheus", "Metrics"),
  datasourceVariable("loki", "loki", "Logs"),
  datasourceVariable("tempo", "tempo", "Traces"),
  queryVariable("service", "Service", 'label_values(target_info{telemetry_sdk_language="dotnet"}, job)', { current: { text: "penny-backend", value: "penny-backend" } }),
  queryVariable("environment", "Environment", 'label_values(target_info{job="$service"}, deployment_environment_name)', { all: true }),
  queryVariable("instance", "Instance", 'label_values(target_info{job="$service", deployment_environment_name=~"$environment"}, instance)', { all: true, multi: true }),
  ...extra,
];

// Marks each API start: an instance (or version) that was not reporting two minutes earlier.
const restartAnnotation = {
  name: "API starts",
  datasource: PROM,
  enable: true,
  iconColor: "purple",
  expr: `max by (instance, service_version) (target_info{${F}}) unless max by (instance, service_version) (target_info{${F}} offset 2m)`,
  step: "1m",
  titleFormat: "API instance started",
  textFormat: "{{instance}} {{service_version}}",
};

function dashboard(uid, title, description, board, variables, { annotations = [restartAnnotation], tags = [] } = {}) {
  return {
    uid,
    title,
    description,
    tags: ["penny", ...tags],
    editable: true,
    graphTooltip: 1,
    timezone: "browser",
    refresh: "1m",
    schemaVersion: 41,
    time: { from: "now-6h", to: "now" },
    fiscalYearStartMonth: 0,
    liveNow: false,
    links: [{ title: "Penny dashboards", type: "dashboards", tags: ["penny"], asDropdown: true, includeVars: false, keepTime: true, icon: "external link", targetBlank: false }],
    annotations: {
      list: [
        { builtIn: 1, datasource: { type: "grafana", uid: "-- Grafana --" }, enable: true, hide: true, iconColor: "rgba(0, 211, 255, 1)", name: "Annotations & Alerts", type: "dashboard" },
        ...annotations,
      ],
    },
    templating: { list: variables },
    panels: board.panels,
  };
}

// --- API overview ---------------------------------------------------------------------------

function apiOverview() {
  const b = new Board();
  b.row("Overview");
  b.stat("Instances up", 3, `count(max by (instance) (last_over_time(target_info{${F}}[5m])))`, {
    description: "API processes that exported telemetry in the last 5 minutes. Zero means the API is down or cannot reach Alloy.",
    steps: [["red", null], ["green", 1]],
    graph: "none",
  });
  b.stat("Requests / s", 3, `sum(rate(http_server_request_duration_seconds_count{${APP}}[$__rate_interval]))`, {
    unit: "reqps",
    decimals: 2,
    description: "Excluding /api/health and /api/ready.",
  });
  b.stat(
    "5xx ratio",
    3,
    `sum(rate(http_server_request_duration_seconds_count{${APP}, http_response_status_code=~"5.."}[$__rate_interval])) / sum(rate(http_server_request_duration_seconds_count{${APP}}[$__rate_interval]))`,
    { unit: "percentunit", decimals: 2, steps: [["green", null], ["orange", 0.01], ["red", 0.05]], description: "Share of requests answered with a 5xx status." },
  );
  b.stat("p95 latency", 3, histogram(0.95, "http_server_request_duration_seconds"), { unit: "s", decimals: 3, steps: [["green", null], ["orange", 0.5], ["red", 2]] });
  b.stat(
    "Readiness failures",
    3,
    `sum(increase(http_server_request_duration_seconds_count{${F}, http_route="api/ready", http_response_status_code!="200"}[$__range]))`,
    { decimals: 0, graph: "none", steps: [["green", null], ["red", 1]], description: "Non-200 answers to /api/ready (the container health check) in the selected range." },
  );
  b.stat("Sign-in failures", 3, `sum(increase(penny_auth_sign_ins_total{${F}, penny_outcome="failure"}[$__range]))`, {
    decimals: 0,
    graph: "none",
    steps: [["green", null], ["orange", 10], ["red", 50]],
    description: "Failed password, OIDC and registration attempts in the selected range.",
  });
  b.stat("Job failures", 3, `sum(increase(penny_job_failures_total{${F}}[$__range]))`, {
    decimals: 0,
    graph: "none",
    steps: [["green", null], ["red", 1]],
    description: "Background work that failed (and will be retried) in the selected range.",
  });
  b.stat("Unhandled exceptions", 3, `sum(increase(aspnetcore_diagnostics_exceptions_total{${F}}[$__range]))`, {
    decimals: 0,
    graph: "none",
    steps: [["green", null], ["red", 1]],
    description: "Exceptions that reached the ASP.NET Core exception handler in the selected range.",
  });
  b.table(
    "Instances",
    24,
    5,
    [
      [`max by (instance, service_version, deployment_environment_name) (last_over_time(target_info{${F}}[5m]))`, "Up"],
      [`max by (instance) (dotnet_process_memory_working_set_bytes{${F}})`, "Working set"],
      [`sum by (instance) (rate(dotnet_process_cpu_time_seconds_total{${F}}[5m])) / max by (instance) (dotnet_process_cpu_count{${F}})`, "CPU"],
      [`sum by (instance) (rate(http_server_request_duration_seconds_count{${APP}}[5m]))`, "Requests / s (5m)"],
    ],
    {
      overrides: [
        { matcher: { id: "byName", options: "Up" }, properties: [{ id: "custom.hidden", value: true }] },
        { matcher: { id: "byName", options: "Working set" }, properties: [{ id: "unit", value: "bytes" }] },
        { matcher: { id: "byName", options: "CPU" }, properties: [{ id: "unit", value: "percentunit" }, { id: "decimals", value: 1 }] },
        { matcher: { id: "byName", options: "Requests / s (5m)" }, properties: [{ id: "unit", value: "reqps" }, { id: "decimals", value: 2 }] },
        { matcher: { id: "byName", options: "service_version" }, properties: [{ id: "displayName", value: "Version" }] },
        { matcher: { id: "byName", options: "deployment_environment_name" }, properties: [{ id: "displayName", value: "Environment" }] },
        { matcher: { id: "byName", options: "instance" }, properties: [{ id: "displayName", value: "Instance" }] },
      ],
    },
  );

  b.row("Traffic and latency");
  b.series(
    "Requests by status class",
    12,
    8,
    [[`sum by (status) (label_replace(rate(http_server_request_duration_seconds_count{${APP}}[$__rate_interval]), "status", "\${1}xx", "http_response_status_code", "(.).."))`, "{{status}}"]],
    { unit: "reqps", stack: true, overrides: [fixed("2xx", "green"), fixed("3xx", "blue"), fixed("4xx", "orange"), fixed("5xx", "red")] },
  );
  b.series(
    "Latency",
    12,
    8,
    [
      [histogram(0.5, "http_server_request_duration_seconds"), "p50"],
      [histogram(0.95, "http_server_request_duration_seconds"), "p95"],
      [histogram(0.99, "http_server_request_duration_seconds"), "p99"],
    ],
    { unit: "s" },
  );
  b.series(
    "Requests by route",
    12,
    9,
    [[`sum by (http_request_method, http_route) (rate(http_server_request_duration_seconds_count{${APP}}[$__rate_interval]))`, "{{http_request_method}} {{http_route}}"]],
    { unit: "reqps", stack: true },
  );
  b.series("p95 latency by route", 12, 9, [[histogram(0.95, "http_server_request_duration_seconds", "le, http_request_method, http_route"), "{{http_request_method}} {{http_route}}"]], { unit: "s" });
  b.series(
    "4xx and 5xx by route",
    12,
    8,
    [
      [
        `sum by (http_request_method, http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count{${APP}, http_response_status_code=~"[45].."}[$__rate_interval]))`,
        "{{http_response_status_code}} {{http_request_method}} {{http_route}}",
      ],
    ],
    { unit: "reqps", stack: true, overrides: [red("^5.*")] },
  );
  b.series(
    "In flight and connections",
    12,
    8,
    [
      [`sum(http_server_active_requests{${F}})`, "active requests"],
      [`sum(kestrel_active_connections{${F}})`, "open connections"],
      [`sum(kestrel_queued_connections{${F}})`, "queued connections"],
    ],
    { description: "Queued connections above zero means Kestrel is not accepting connections fast enough." },
  );
  const routeColumn = (status) =>
    `sum by (http_request_method, http_route) (increase(http_server_request_duration_seconds_count{${APP}${status ? `, http_response_status_code=~"${status}"` : ""}}[$__range]))`;
  b.table(
    "Routes in the selected range",
    24,
    9,
    [
      [routeColumn(), "Requests"],
      [routeColumn("4.."), "4xx"],
      [routeColumn("5.."), "5xx"],
      [histogram(0.5, "http_server_request_duration_seconds", "le, http_request_method, http_route", APP, "$__range"), "p50"],
      [histogram(0.95, "http_server_request_duration_seconds", "le, http_request_method, http_route", APP, "$__range"), "p95"],
      [histogram(0.99, "http_server_request_duration_seconds", "le, http_request_method, http_route", APP, "$__range"), "p99"],
    ],
    {
      sortBy: [{ displayName: "Requests", desc: true }],
      overrides: [
        { matcher: { id: "byRegexp", options: "Requests|4xx|5xx" }, properties: [{ id: "decimals", value: 0 }] },
        {
          matcher: { id: "byRegexp", options: "p50|p95|p99" },
          properties: [
            { id: "unit", value: "s" },
            { id: "decimals", value: 3 },
            { id: "custom.cellOptions", value: { type: "color-text" } },
            { id: "thresholds", value: thresholds(["green", null], ["orange", 0.5], ["red", 2]) },
          ],
        },
        { matcher: { id: "byName", options: "5xx" }, properties: [{ id: "custom.cellOptions", value: { type: "color-text" } }, { id: "thresholds", value: thresholds(["text", null], ["red", 1]) }] },
        { matcher: { id: "byName", options: "http_request_method" }, properties: [{ id: "displayName", value: "Method" }, { id: "custom.width", value: 90 }] },
        { matcher: { id: "byName", options: "http_route" }, properties: [{ id: "displayName", value: "Route" }] },
      ],
    },
  );

  b.row("Logs");
  b.logVolume("Log lines by level", 24, 7, `sum by (detected_level) (count_over_time(${LSEL} [$__auto]))`);
  b.logs("Warnings and errors", 24, 10, `${LSEL} | severity_number >= 13`, "Expand a line and follow View trace to open the request in Tempo.");
  b.logs("Search logs", 24, 10, `${LSEL} |= "$search"`, "Type in the Log search box at the top. Logs never contain user content, so search for ids, routes and messages.");

  b.row("Traces");
  b.traces(
    "Failed requests and job passes",
    12,
    10,
    '{ resource.service.name = "$service" && status = error }',
    "Requests answered with a 5xx status and failed worker passes. Open a trace to see its SQL and outgoing calls.",
  );
  b.traces("Slow requests (over $slow)", 12, 10, '{ resource.service.name = "$service" && kind = server && duration > $slow }');
  b.traces(
    "Trace by request id",
    24,
    8,
    '{ resource.service.name = "$service" && span.penny.request_id = "$request_id" }',
    "Paste the X-Request-Id a user reported (or the id from a 500 log line) into the Request id box at the top.",
  );

  return dashboard(
    "penny-api",
    "Penny API",
    "Penny .NET API overview: health, traffic, errors, latency by route, logs and traces.",
    b,
    apiVariables(customVariable("slow", "Slow request", ["250ms", "500ms", "1s", "2s", "5s"], "500ms"), textVariable("request_id", "Request id"), textVariable("search", "Log search")),
    { tags: ["api"] },
  );
}

// --- Database -------------------------------------------------------------------------------

function database() {
  const b = new Board();
  b.row("Connection pool");
  b.stat("Connections in use", 6, `sum(db_client_connection_count{${F}, db_client_connection_state="used"})`, { decimals: 0 });
  b.stat("Pool size limit", 6, `sum(db_client_connection_max{${F}})`, { decimals: 0, graph: "none" });
  b.stat(
    "Pool use",
    6,
    `sum(db_client_connection_count{${F}, db_client_connection_state="used"}) / sum(db_client_connection_max{${F}})`,
    { unit: "percentunit", decimals: 0, steps: [["green", null], ["orange", 0.7], ["red", 0.9]], description: "Near 100% means requests wait for a free connection." },
  );
  b.stat("Query p95", 6, histogram(0.95, "db_client_operation_duration_seconds", "le", F), { unit: "s", decimals: 3, steps: [["green", null], ["orange", 0.1], ["red", 0.5]] });
  b.series(
    "Connections",
    12,
    8,
    [
      [`sum by (db_client_connection_state) (db_client_connection_count{${F}})`, "{{db_client_connection_state}}"],
      [`sum(db_client_connection_max{${F}})`, "max"],
    ],
    {
      overrides: [
        {
          matcher: { id: "byName", options: "max" },
          properties: [
            { id: "custom.lineStyle", value: { fill: "dash", dash: [10, 10] } },
            { id: "color", value: { mode: "fixed", fixedColor: "red" } },
            { id: "custom.fillOpacity", value: 0 },
          ],
        },
      ],
    },
  );
  b.series("New connection time", 12, 8, [[histogram(0.95, "db_client_connection_npgsql_create_time_seconds", "le", F), "p95"]], {
    unit: "s",
    description: "Time to open a new PostgreSQL connection. Rising values point at the database host or network.",
  });

  b.row("Queries");
  b.series(
    "Query duration",
    12,
    8,
    [
      [histogram(0.5, "db_client_operation_duration_seconds", "le", F), "p50"],
      [histogram(0.95, "db_client_operation_duration_seconds", "le", F), "p95"],
      [histogram(0.99, "db_client_operation_duration_seconds", "le", F), "p99"],
    ],
    { unit: "s" },
  );
  b.series(
    "Queries / s and in flight",
    12,
    8,
    [
      [`sum(rate(db_client_operation_duration_seconds_count{${F}}[$__rate_interval]))`, "queries / s"],
      [`sum(db_client_operation_npgsql_executing{${F}})`, "executing"],
    ],
  );
  b.series(
    "Bytes to and from PostgreSQL",
    12,
    8,
    [
      [`sum(rate(db_client_operation_npgsql_bytes_read_total{${F}}[$__rate_interval]))`, "read"],
      [`sum(rate(db_client_operation_npgsql_bytes_written_total{${F}}[$__rate_interval]))`, "written"],
    ],
    { unit: "Bps" },
  );
  b.series("Prepared statement ratio", 12, 8, [[`avg(db_client_operation_npgsql_prepared_ratio{${F}})`, "prepared"]], { unit: "percentunit" });

  b.row("Slow queries");
  b.traces(
    "Queries slower than $slow_query",
    24,
    10,
    '{ resource.service.name = "$service" && span.db.system.name = "postgresql" && duration > $slow_query }',
    "PostgreSQL command spans. Open one to see the parameterized statement (db.query.text) and the request it ran for. Parameter values are never recorded.",
  );
  b.logs("Database warnings and errors", 24, 8, `${LSEL} | severity_number >= 13 | scope_name =~ "(?i).*(npgsql|entityframework|persistence).*"`);

  return dashboard(
    "penny-database",
    "Penny database",
    "PostgreSQL as the Penny API sees it: Npgsql pool, query latency and throughput, slow queries.",
    b,
    apiVariables(customVariable("slow_query", "Slow query", ["50ms", "100ms", "250ms", "500ms", "1s"], "100ms")),
    { tags: ["database"] },
  );
}

// --- Auth and rate limits -------------------------------------------------------------------

function auth() {
  const b = new Board();
  const AUTH_ROUTES = `${APP}, http_route=~"api/auth.*"`;
  b.row("Sign-ins");
  b.stat("Sign-ins", 6, `sum(increase(penny_auth_sign_ins_total{${F}, penny_outcome="success"}[$__range]))`, { decimals: 0, graph: "none", description: "Successful password, OIDC and registration sign-ins in the selected range." });
  b.stat("Failed sign-ins", 6, `sum(increase(penny_auth_sign_ins_total{${F}, penny_outcome="failure"}[$__range]))`, { decimals: 0, graph: "none", steps: [["green", null], ["orange", 10], ["red", 50]] });
  b.stat(
    "Failure ratio",
    6,
    `sum(increase(penny_auth_sign_ins_total{${F}, penny_outcome="failure"}[$__range])) / sum(increase(penny_auth_sign_ins_total{${F}}[$__range]))`,
    { unit: "percentunit", decimals: 0, graph: "none", steps: [["green", null], ["orange", 0.3], ["red", 0.6]] },
  );
  b.stat("Rate-limited (429)", 6, `sum(increase(penny_rate_limit_rejections_total{${F}}[$__range]))`, { decimals: 0, graph: "none", steps: [["green", null], ["orange", 1]] });
  b.counts("Sign-ins by method and outcome", 12, 8, [[`sum by (penny_auth_method, penny_outcome) (increase(penny_auth_sign_ins_total{${F}}[$__interval]))`, "{{penny_auth_method}} {{penny_outcome}}"]], {
    overrides: [red(".*failure")],
  });
  b.counts("Failed sign-ins by kind", 12, 8, [[`sum by (penny_auth_method, error_type) (increase(penny_auth_sign_ins_total{${F}, penny_outcome="failure"}[$__interval]))`, "{{penny_auth_method}} {{error_type}}"]], {
    description: "A burst of unauthorized password failures can be credential stuffing; compare with the auth rate-limit rejections.",
  });

  b.row("Rate limits");
  b.counts("Rejections by policy", 12, 8, [[`sum by (penny_rate_limit_policy) (increase(penny_rate_limit_rejections_total{${F}}[$__interval]))`, "{{penny_rate_limit_policy}}"]]);
  b.series(
    "Limiter decisions",
    12,
    8,
    [[`sum by (aspnetcore_rate_limiting_policy, aspnetcore_rate_limiting_result) (rate(aspnetcore_rate_limiting_requests_total{${F}}[$__rate_interval]))`, "{{aspnetcore_rate_limiting_policy}} {{aspnetcore_rate_limiting_result}}"]],
    { unit: "reqps", stack: true, overrides: [red(".*rejected.*")] },
  );

  b.row("Sessions and access");
  b.series(
    "Authentication results",
    12,
    8,
    [[`sum by (aspnetcore_authentication_scheme, aspnetcore_authentication_result) (rate(aspnetcore_authentication_authenticate_duration_seconds_count{${F}}[$__rate_interval]))`, "{{aspnetcore_authentication_scheme}} {{aspnetcore_authentication_result}}"]],
    { unit: "reqps", stack: true, description: "Session and bearer checks per request. A rise in failure means clients send expired or revoked sessions." },
  );
  b.series(
    "401, 403 and 429 by route",
    12,
    8,
    [[`sum by (http_response_status_code, http_request_method, http_route) (rate(http_server_request_duration_seconds_count{${APP}, http_response_status_code=~"401|403|429"}[$__rate_interval]))`, "{{http_response_status_code}} {{http_request_method}} {{http_route}}"]],
    { unit: "reqps", stack: true },
  );
  b.series("Sign-in endpoint latency", 12, 8, [[histogram(0.95, "http_server_request_duration_seconds", "le, http_request_method, http_route", AUTH_ROUTES), "p95 {{http_request_method}} {{http_route}}"]], {
    unit: "s",
    description: "Password hashing makes sign-in deliberately slow; watch for changes, not the absolute value.",
  });
  b.series(
    "Authorization decisions",
    12,
    8,
    [[`sum by (aspnetcore_authorization_result) (rate(aspnetcore_authorization_attempts_total{${F}}[$__rate_interval]))`, "{{aspnetcore_authorization_result}}"]],
    { unit: "reqps", stack: true },
  );

  b.row("Sync and households");
  b.counts("Ledger save conflicts (409)", 12, 8, [[`sum(increase(penny_ledger_conflicts_total{${F}}[$__interval]))`, "conflicts"]], {
    description: "PUT /api/ledger refused because the revision moved on. Occasional conflicts are normal with several devices; a steady stream means a client keeps retrying a stale revision.",
  });
  b.counts("Household joins by outcome", 12, 8, [[`sum by (penny_outcome, error_type) (increase(penny_household_joins_total{${F}}[$__interval]))`, "{{penny_outcome}} {{error_type}}"]], {
    overrides: [red("failure.*")],
  });
  b.logs("Auth warnings and errors", 24, 8, `${LSEL} | severity_number >= 13 | scope_name =~ "(?i).*(auth|identity|oidc|ratelimit).*"`);

  return dashboard("penny-auth", "Penny auth and rate limits", "Sign-ins, rate limiting, sessions, ledger conflicts and household joins.", b, apiVariables(), { tags: ["security"] });
}

// --- Background jobs ------------------------------------------------------------------------

function jobs() {
  const b = new Board();
  b.text(
    "Workers claim **due** work: push deliveries and receipts, search embeddings, shared recurrences and receipt text. **Lag** is the time from when work became due to when a worker claimed it; recurrence lag counts from the start of the occurrence's UTC day, so hours there are normal. Failed items are retried.",
  );
  b.row("Throughput and failures");
  b.stat("Items claimed", 8, `sum(increase(penny_job_items_total{${F}}[$__range]))`, { decimals: 0, graph: "none" });
  b.stat("Failures", 8, `sum(increase(penny_job_failures_total{${F}}[$__range]))`, { decimals: 0, graph: "none", steps: [["green", null], ["red", 1]] });
  b.stat("Worst lag p95 (excluding recurrence)", 8, `max(${histogram(0.95, "penny_job_lag_seconds", "le, penny_job", `${F}, penny_job!="recurrence"`, "$__range")})`, {
    unit: "s",
    graph: "none",
    steps: [["green", null], ["orange", 300], ["red", 900]],
  });
  b.counts("Items claimed by job", 12, 8, [[`sum by (penny_job) (increase(penny_job_items_total{${F}}[$__interval]))`, "{{penny_job}}"]]);
  b.counts("Failures by job and exception", 12, 8, [[`sum by (penny_job, error_type) (increase(penny_job_failures_total{${F}}[$__interval]))`, "{{penny_job}} {{error_type}}"]], {
    description: "Follow a failure to its worker pass in the Traces row below.",
  });
  b.series("Lag p95 by job", 12, 8, [[histogram(0.95, "penny_job_lag_seconds", "le, penny_job", F), "{{penny_job}}"]], { unit: "s" });
  b.series("Lag p50 by job", 12, 8, [[histogram(0.5, "penny_job_lag_seconds", "le, penny_job", F), "{{penny_job}}"]], { unit: "s" });

  b.row("Receipt text (OCR)");
  b.counts(
    "Extraction results",
    12,
    8,
    [[`sum by (penny_receipt_text_status, penny_receipt_text_method) (increase(penny_receipt_text_results_total{${F}}[$__interval]))`, "{{penny_receipt_text_status}} {{penny_receipt_text_method}}"]],
    { overrides: [red("failed.*")] },
  );
  b.series(
    "Extraction time",
    12,
    8,
    [
      [histogram(0.5, "penny_receipt_text_duration_seconds", "le", F), "p50"],
      [histogram(0.95, "penny_receipt_text_duration_seconds", "le", F), "p95"],
    ],
    { unit: "s" },
  );

  b.row("Push and providers");
  b.series(
    "Outgoing HTTP by host and status",
    12,
    8,
    [[`sum by (server_address, http_response_status_code) (rate(http_client_request_duration_seconds_count{${F}}[$__rate_interval]))`, "{{server_address}} {{http_response_status_code}}"]],
    { unit: "reqps", overrides: [red(".* 5..$")], description: "Calls to the OIDC provider, APNs and Expo." },
  );
  b.series("Outgoing HTTP p95", 12, 8, [[histogram(0.95, "http_client_request_duration_seconds", "le, server_address", F), "{{server_address}}"]], { unit: "s" });

  b.row("Traces and logs");
  b.traces("Worker passes", 12, 10, '{ resource.service.name = "$service" && span.penny.job != nil }', "One span per worker pass that claimed work, with its SQL and provider calls.");
  b.traces("Failed worker passes", 12, 10, '{ resource.service.name = "$service" && span.penny.job != nil && status = error }');
  b.logs("Worker warnings and errors", 24, 8, `${LSEL} | severity_number >= 13 | scope_name =~ "(?i).*(worker|push|search|recurrence|receipt|ocr|outbox).*"`);

  return dashboard("penny-jobs", "Penny background jobs", "Push delivery, search embeddings, shared recurrences and receipt text: throughput, failures and lag.", b, apiVariables(), { tags: ["jobs"] });
}

// --- .NET runtime ---------------------------------------------------------------------------

function runtime() {
  const b = new Board();
  b.row("CPU and memory");
  b.series(
    "CPU",
    8,
    8,
    [[`sum by (cpu_mode) (rate(dotnet_process_cpu_time_seconds_total{${F}}[$__rate_interval])) / scalar(max(dotnet_process_cpu_count{${F}}))`, "{{cpu_mode}}"]],
    { unit: "percentunit", stack: true, description: "Share of all logical CPUs available to the process. Receipt OCR runs in child processes and is not counted here." },
  );
  b.series(
    "Memory",
    8,
    8,
    [
      [`sum(dotnet_process_memory_working_set_bytes{${F}})`, "working set"],
      [`sum(dotnet_gc_last_collection_memory_committed_size_bytes{${F}})`, "GC committed"],
      [`sum(dotnet_gc_last_collection_heap_size_bytes{${F}})`, "GC heap"],
    ],
    { unit: "bytes", description: "The search model lives outside the GC heap, so the working set is well above the heap size. The container limit is PENNY_API_MEMORY (default 3 GiB)." },
  );
  b.series("GC heap by generation", 8, 8, [[`sum by (gc_heap_generation) (dotnet_gc_last_collection_heap_size_bytes{${F}})`, "{{gc_heap_generation}}"]], { unit: "bytes", stack: true });

  b.row("Garbage collection");
  b.series("Collections", 8, 8, [[`sum by (gc_heap_generation) (rate(dotnet_gc_collections_total{${F}}[$__rate_interval]))`, "{{gc_heap_generation}}"]], { unit: "ops" });
  b.series("Pause time", 8, 8, [[`sum(rate(dotnet_gc_pause_time_seconds_total{${F}}[$__rate_interval]))`, "paused"]], {
    unit: "percentunit",
    description: "Share of wall time the runtime spent paused for garbage collection.",
  });
  b.series("Allocation rate", 8, 8, [[`sum(rate(dotnet_gc_heap_allocated_bytes_total{${F}}[$__rate_interval]))`, "allocated"]], { unit: "Bps" });

  b.row("Threads and exceptions");
  b.series(
    "Thread pool",
    8,
    8,
    [
      [`sum(dotnet_thread_pool_thread_count_total{${F}})`, "threads"],
      [`sum(dotnet_thread_pool_queue_length_total{${F}})`, "queued work items"],
    ],
    { description: "A growing queue with a climbing thread count is thread-pool starvation (blocking on async work)." },
  );
  b.series("Lock contention", 8, 8, [[`sum(rate(dotnet_monitor_lock_contentions_total{${F}}[$__rate_interval]))`, "contentions / s"]]);
  b.counts("Exceptions by type", 8, 8, [[`sum by (error_type) (increase(dotnet_exceptions_total{${F}}[$__interval]))`, "{{error_type}}"]], {
    description: "Every thrown exception, including handled ones (cancelled requests, validation).",
  });

  b.row("Kestrel");
  b.series(
    "Connections",
    8,
    8,
    [
      [`sum(kestrel_active_connections{${F}})`, "open"],
      [`sum(kestrel_queued_connections{${F}})`, "queued"],
    ],
  );
  b.series("Connection duration p95", 8, 8, [[histogram(0.95, "kestrel_connection_duration_seconds", "le", F), "p95"]], { unit: "s" });
  b.series(
    "Memory pool",
    8,
    8,
    [
      [`sum(aspnetcore_memory_pool_pooled_bytes{${F}})`, "pooled"],
      [`sum(rate(aspnetcore_memory_pool_rented_bytes_total{${F}}[$__rate_interval]))`, "rented / s"],
    ],
    { unit: "bytes" },
  );

  return dashboard("penny-runtime", "Penny .NET runtime", "CPU, memory, garbage collection, thread pool, exceptions and Kestrel for the Penny API.", b, apiVariables(), { tags: ["runtime"] });
}

// --- Clients --------------------------------------------------------------------------------

// The client telemetry contract (docs/observability.md#client-telemetry): web and iOS send
// OTLP with service.name penny-web or penny-ios and service.version set to the app version.
// An error is a log record with severity ERROR (17-20) and exception.type; a crash is a log
// record with severity FATAL (21+) sent on the next launch. Faro (web) errors are Loki lines
// with kind=exception. Client spans propagate traceparent to the API.
function clients() {
  const b = new Board();
  const CSEL = '{service_name=~"$client"}';
  // OTLP log records keep severity as structured metadata; Faro lines are logfmt.
  const ERRORS = `${CSEL} | logfmt | drop __error__, __error_details__ | severity_number >= 17 or kind = "exception"`;
  const CRASHES = `${CSEL} | severity_number >= 21`;
  b.text(
    "Errors and crashes from the web and iOS apps. Client telemetry is opt-in per server and off in demo mode, so these panels stay empty until a client turns it on. Open a failed client trace to follow it into the API and its SQL.",
  );
  b.row("Errors and crashes");
  b.stat("Errors", 6, `sum(count_over_time(${ERRORS} [$__range]))`, { datasource: LOKI, decimals: 0, graph: "none", steps: [["green", null], ["orange", 1], ["red", 50]] });
  b.stat("Crashes", 6, `sum(count_over_time(${CRASHES} [$__range]))`, { datasource: LOKI, decimals: 0, graph: "none", steps: [["green", null], ["red", 1]] });
  b.stat("Web errors", 6, `sum(count_over_time({service_name="penny-web"} | logfmt | drop __error__, __error_details__ | severity_number >= 17 or kind = "exception" [$__range]))`, {
    datasource: LOKI,
    decimals: 0,
    graph: "none",
  });
  b.stat("iOS errors and crashes", 6, `sum(count_over_time({service_name="penny-ios"} | severity_number >= 17 [$__range]))`, { datasource: LOKI, decimals: 0, graph: "none" });
  b.series(
    "Errors and crashes over time",
    24,
    8,
    [
      [`sum by (service_name) (count_over_time(${ERRORS} [$__auto]))`, "{{service_name}} errors"],
      [`sum by (service_name) (count_over_time(${CRASHES} [$__auto]))`, "{{service_name}} crashes"],
    ],
    { datasource: LOKI, bars: true, stack: true, overrides: [red(".*crashes")] },
  );
  b.table("Top exceptions", 12, 9, [[`topk(20, sum by (service_name, exception_type) (count_over_time(${CSEL} | severity_number >= 17 | exception_type != "" [$__range])))`, "Count"]], {
    datasource: LOKI,
    sortBy: [{ displayName: "Count", desc: true }],
  });
  b.table("Top exceptions (Faro)", 12, 9, [[`topk(20, sum by (type, value) (count_over_time({service_name=~"$client", telemetry_sdk="faro"} | logfmt | kind = "exception" [$__range])))`, "Count"]], {
    datasource: LOKI,
    sortBy: [{ displayName: "Count", desc: true }],
  });
  b.table("Errors by app version", 12, 8, [[`sum by (service_name, service_version) (count_over_time(${CSEL} | severity_number >= 17 [$__range]))`, "Errors"]], {
    datasource: LOKI,
    sortBy: [{ displayName: "Errors", desc: true }],
    description: "A new version with more errors than the one before it is the signal to pull a TestFlight build or roll back the web image.",
  });
  b.table("Crashes by app version", 12, 8, [[`sum by (service_name, service_version, exception_type) (count_over_time(${CRASHES} [$__range]))`, "Crashes"]], {
    datasource: LOKI,
    sortBy: [{ displayName: "Crashes", desc: true }],
  });
  b.logs("Recent errors and crashes", 24, 10, ERRORS, "Expand a line: a trace id links to the client trace and from there to the API.");

  b.row("Client traces");
  b.traces("Failed client operations", 12, 10, '{ resource.service.name =~ "$client" && status = error }', "Client spans that failed. Their API calls continue into penny-backend in the same trace.");
  b.traces("Slow API calls from clients (over $slow)", 12, 10, '{ resource.service.name =~ "$client" && kind = client && duration > $slow }');

  return dashboard(
    "penny-clients",
    "Penny clients",
    "Errors, crashes and failed operations reported by the Penny web and iOS apps (opt-in client telemetry).",
    b,
    [
      datasourceVariable("loki", "loki", "Logs"),
      datasourceVariable("tempo", "tempo", "Traces"),
      {
        name: "client",
        label: "Client",
        type: "custom",
        query: "penny-web,penny-ios",
        current: { text: ["All"], value: ["$__all"] },
        options: [],
        includeAll: true,
        allValue: CLIENTS,
        multi: true,
        hide: 0,
      },
      customVariable("slow", "Slow call", ["500ms", "1s", "2s", "5s"], "1s"),
    ],
    { annotations: [], tags: ["clients"] },
  );
}

export const dashboards = { "penny-api.json": apiOverview, "penny-database.json": database, "penny-auth.json": auth, "penny-jobs.json": jobs, "penny-runtime.json": runtime, "penny-clients.json": clients };

export function render() {
  return Object.fromEntries(Object.entries(dashboards).map(([file, build]) => [file, JSON.stringify(build(), null, 2) + "\n"]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rendered = render();
  if (process.argv.includes("--check")) {
    const present = readdirSync(dashboardDirectory).filter((file) => file.endsWith(".json"));
    const problems = [
      ...Object.entries(rendered)
        .filter(([file, text]) => {
          try {
            return readFileSync(path.join(dashboardDirectory, file), "utf8") !== text;
          } catch {
            return true;
          }
        })
        .map(([file]) => `${file} is out of date`),
      ...present.filter((file) => !(file in rendered)).map((file) => `${file} is not generated by this script`),
    ];
    if (problems.length) {
      console.error(`${problems.join("\n")}\nRun npm run dashboards:generate.`);
      process.exit(1);
    }
    console.log(`${Object.keys(rendered).length} dashboards up to date`);
  } else {
    mkdirSync(dashboardDirectory, { recursive: true });
    for (const [file, text] of Object.entries(rendered)) writeFileSync(path.join(dashboardDirectory, file), text);
    console.log(`wrote ${Object.keys(rendered).join(", ")}`);
  }
}
