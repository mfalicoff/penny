// MAZ-128: the provisioned Grafana dashboards and alert rules stay consistent with their
// generator and with the data sources the reference stack provisions. The smoke test
// (scripts/observability-smoke.mjs) checks that Grafana actually loads and evaluates them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dashboardDirectory, render } from "../../scripts/grafana-dashboards.mjs";

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

test("dashboard JSON matches scripts/grafana-dashboards.mjs (npm run dashboards:generate)", () => {
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
  for (const [file, board] of boards.filter(([, b]) => b.uid !== "penny-clients")) {
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
  assert.equal(uids.length, 8);
  assert.equal(new Set(uids).size, uids.length);
  for (const [, uid] of alerts.matchAll(/datasourceUid: (\S+)/g)) {
    assert.ok(uid === "__expr__" || datasources.includes(uid), `alert rule data source ${uid} is not provisioned`);
  }
});

test("only client ingest is exposed and every image is pinned by digest", () => {
  const compose = read("compose.yaml");
  for (const [, image] of compose.matchAll(/^\s+image: (\S+)$/gm)) assert.match(image, /:[^@]+@sha256:[0-9a-f]{64}$/, image);
  const ports = [...compose.matchAll(/^\s+- "\$\{[A-Z_]+:-127\.0\.0\.1\}:\$\{[A-Z_]+:-\d+\}:(\d+)"$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(ports, ["12347", "3000", "4319"]);
  assert.doesNotMatch(compose, /:4317"|:4318"/, "the API's OTLP ports stay internal");
});

test("the operator stack pins the same images as the local AppHost", () => {
  const appHost = readFileSync(new URL("../../apps/backend/src/Penny.Backend.AppHost/ObservabilityImages.cs", import.meta.url), "utf8");
  const pinned = [...appHost.matchAll(/new\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([0-9a-f]{64})"\s*\)/g)].map(([, registry, image, tag, digest]) => `${registry}/${image}:${tag}@sha256:${digest}`);
  const compose = [...read("compose.yaml").matchAll(/^\s+image: (\S+)$/gm)].map((match) => match[1]);
  assert.equal(pinned.length, 5);
  assert.deepEqual(compose.sort(), pinned.sort());
});
