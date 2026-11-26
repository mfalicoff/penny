// MAZ-128: the provisioned Grafana dashboards and alert rules stay consistent with their
// generator and with the data sources the reference stack provisions. The smoke test
// (scripts/observability-smoke.mjs) checks that Grafana actually loads and evaluates them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { alertFile, alertGroups, dashboardDirectory, pushRequests, render, renderAlerts, resolveDatasources } from "../../scripts/grafana-dashboards.mjs";

const observability = new URL("../../apps/backend/development/observability/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, observability), "utf8");

type Panel = {
  id: number;
  type: string;
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  datasource?: { type: string; uid: string };
  targets?: { datasource?: { type: string; uid: string }; expr?: string; query?: string }[];
};
type Dashboard = { uid: string; title: string; panels: Panel[]; tags: string[] };

const rendered: Record<string, string> = render();
const boards = Object.entries(rendered).map(([file, text]) => [file, JSON.parse(text) as Dashboard] as const);

test("dashboard JSON matches scripts/grafana-dashboards.mjs (node scripts/grafana-dashboards.mjs)", () => {
  const files = readdirSync(dashboardDirectory).filter((file) => file.endsWith(".json")).sort();
  assert.deepEqual(files, Object.keys(rendered).sort());
  for (const [file, text] of Object.entries(rendered)) {
    assert.equal(readFileSync(`${dashboardDirectory}/${file}`, "utf8"), text, `${file} is out of date`);
  }
});

test("starter dashboards cover the areas operators need", () => {
  assert.deepEqual(boards.map(([, board]) => board.uid).sort(), ["penny-api", "penny-auth", "penny-clients", "penny-database", "penny-jobs", "penny-runtime"]);
  for (const [, board] of boards) assert.ok(board.tags.includes("penny"), `${board.uid} is linked from the Penny dashboards menu`);
});

test("panels have unique ids, fit the grid and query through data source variables", () => {
  for (const [file, board] of boards) {
    const ids = board.panels.map((panel) => panel.id);
    assert.equal(new Set(ids).size, ids.length, `${file}: duplicate panel id`);
    for (const panel of board.panels) {
      const where = `${file} "${panel.title}"`;
      assert.ok(panel.gridPos.x >= 0 && panel.gridPos.x + panel.gridPos.w <= 24, `${where} overflows the 24-column grid`);
      if (panel.type === "row" || panel.type === "text") continue;
      assert.ok(panel.targets?.length, `${where} has no query`);
      for (const source of [panel.datasource, ...(panel.targets ?? []).map((target) => target.datasource)]) {
        assert.match(source?.uid ?? "", /^\$\{(prometheus|loki|tempo)\}$/, `${where} uses a fixed data source`);
      }
      for (const target of panel.targets ?? []) assert.ok((target.expr ?? target.query ?? "").trim(), `${where} has an empty query`);
    }
  }
});

test("API panels filter by service, environment and instance", () => {
  for (const [file, board] of boards) {
    for (const panel of board.panels) {
      for (const target of panel.targets ?? []) {
        if (target.datasource?.type !== "prometheus" || !target.expr) continue;
        for (const selector of target.expr.match(/\b[a-z_]+\{[^}]*\}/g) ?? []) {
          assert.match(selector, /job="\$service", instance=~"\$instance", deployment_environment_name=~"\$environment"/, `${file} "${panel.title}": ${selector}`);
        }
      }
    }
  }
});

test("alert rules use provisioned data sources and unique ids", () => {
  const datasources = [...read("grafana/provisioning/datasources/datasources.yaml").matchAll(/^\s+uid: (\S+)$/gm)].map((match) => match[1]);
  const alerts = read("grafana/provisioning/alerting/penny.yaml");
  const uids = [...alerts.matchAll(/^\s+- uid: (\S+)$/gm)].map((match) => match[1]);
  assert.equal(uids.length, 11);
  assert.equal(new Set(uids).size, uids.length);
  for (const [, uid] of alerts.matchAll(/datasourceUid: (\S+)/g)) {
    assert.ok(uid === "__expr__" || datasources.includes(uid), `alert rule data source ${uid} is not provisioned`);
  }
});

test("the operator guide's alert table lists every provisioned rule", () => {
  const guide = readFileSync(new URL("../../docs/self-hosting/observability.md", import.meta.url), "utf8");
  const section = guide.slice(guide.indexOf("\n## Alerts\n"), guide.indexOf("\n## ", guide.indexOf("\n## Alerts\n") + 1));
  const documented = [...section.matchAll(/^\| (Penny [^|]+?) \|/gm)].map((match) => match[1]).sort();
  const titles = [...read("grafana/provisioning/alerting/penny.yaml").matchAll(/^\s+title: (.+)$/gm)].map((match) => match[1].trim()).sort();
  assert.deepEqual(documented, titles);
});

test("only Grafana is exposed and every image is pinned by digest", () => {
  const compose = read("compose.yaml");
  for (const [, image] of compose.matchAll(/^\s+image: (\S+)$/gm)) assert.match(image, /:[^@]+@sha256:[0-9a-f]{64}$/, image);
  const ports = [...compose.matchAll(/^\s+- "\$\{[A-Z_]+:-127\.0\.0\.1\}:\$\{[A-Z_]+:-\d+\}:(\d+)"$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(ports, ["3000"]);
  // MAZ-129: clients post telemetry to the API, which forwards it; Alloy publishes nothing.
  assert.doesNotMatch(compose, /:4317"|:4318"|:4319"|:12347"/, "Alloy's receivers stay internal");
  assert.doesNotMatch(read("config.alloy"), /cors/, "no browser ever talks to Alloy");
});

test("the operator stack pins the same images as the local AppHost", () => {
  const appHost = readFileSync(new URL("../../apps/backend/src/Penny.Backend.AppHost/ObservabilityImages.cs", import.meta.url), "utf8");
  const pinned = [...appHost.matchAll(/new\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([0-9a-f]{64})"\s*\)/g)].map(([, registry, image, tag, digest]) => `${registry}/${image}:${tag}@sha256:${digest}`);
  const compose = [...read("compose.yaml").matchAll(/^\s+image: (\S+)$/gm)].map((match) => match[1]);
  assert.equal(pinned.length, 5);
  assert.deepEqual(compose.sort(), pinned.sort());
});

test("alert rules match scripts/grafana-dashboards.mjs (node scripts/grafana-dashboards.mjs)", () => {
  assert.equal(readFileSync(alertFile, "utf8"), renderAlerts(), "penny.yaml is out of date");
});

// MAZ-289: --push. Data source lists here are made up; Grafana Cloud names its own
// grafanacloud-<stack>-prom, -logs and -traces, next to other Loki and Prometheus sources.
const cloud = [
  { uid: "u-prom", name: "grafanacloud-example-prom", type: "prometheus", isDefault: true },
  { uid: "u-usage", name: "grafanacloud-usage", type: "prometheus", isDefault: false },
  { uid: "u-logs", name: "grafanacloud-example-logs", type: "loki", isDefault: false },
  { uid: "u-history", name: "grafanacloud-example-alert-state-history", type: "loki", isDefault: false },
  { uid: "u-traces", name: "grafanacloud-example-traces", type: "tempo", isDefault: false },
];

test("push picks Grafana Cloud's metrics, logs and traces data sources, or the ones named", () => {
  const picked = resolveDatasources(cloud);
  assert.deepEqual(Object.fromEntries(Object.entries(picked).map(([kind, source]) => [kind, source.uid])), { prometheus: "u-prom", loki: "u-logs", tempo: "u-traces" });
  assert.equal(resolveDatasources(cloud, { loki: "grafanacloud-example-alert-state-history" }).loki.uid, "u-history");
  const twoLokis = [...cloud.filter((source) => source.uid !== "u-logs"), { uid: "u-other", name: "loki-b", type: "loki", isDefault: false }];
  assert.throws(() => resolveDatasources(twoLokis), /cannot pick the loki data source.*--loki/);
  assert.throws(() => resolveDatasources(cloud, { tempo: "missing" }), /"missing"/);
});

test("push creates the folder, then every dashboard and rule group, on the chosen data sources", () => {
  const requests = pushRequests(resolveDatasources(cloud), { webApp: "penny" });
  assert.deepEqual(requests[0], { method: "POST", path: "/api/folders", body: { uid: "penny", title: "Penny" }, ok: [200, 409, 412] });
  const boardsPushed = requests.filter((request) => request.path === "/api/dashboards/db");
  assert.deepEqual(boardsPushed.map((request) => request.body.dashboard.uid).sort(), boards.map(([, board]) => board.uid).sort());
  for (const { body } of boardsPushed) {
    assert.equal(body.folderUid, "penny");
    assert.equal(body.overwrite, true);
    assert.equal(body.dashboard.id, null);
    for (const variable of body.dashboard.templating.list) {
      if (variable.type === "datasource") assert.match(variable.current.value, /^u-(prom|logs|traces)$/, `${body.dashboard.uid} ${variable.name}`);
      if (variable.name === "web_app") assert.equal(variable.current.value, "penny");
    }
  }
  const groups = requests.filter((request) => request.method === "PUT");
  assert.deepEqual(groups.map((request) => request.path), alertGroups.map((group) => `/api/v1/provisioning/folder/penny/rule-groups/${encodeURIComponent(group.name)}`));
  const rules = groups.flatMap((request) => request.body.rules);
  assert.equal(rules.length, 11);
  for (const rule of rules) {
    assert.equal(rule.folderUID, "penny");
    for (const query of rule.data) assert.match(query.datasourceUid, /^(u-prom|u-logs|__expr__)$/, rule.uid);
  }
  assert.equal(groups.find((request) => request.body.title === "Penny clients")?.body.interval, 300);
  // The repository's dashboards keep the provisioned names; only the pushed copies change.
  assert.equal(JSON.parse(rendered["penny-clients.json"]).templating.list.find((variable: { name: string }) => variable.name === "web_app").current.value, "penny-web");
});
