// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDist } from "../scripts/verify-dist.ts";

let root = "";

function site(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "penny-dist-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const good = {
  "index.html": '<link rel="icon" href="/favicon.svg"><script type="module" src="/assets/index-a1.js"></script><link href="/assets/index-b2.css">',
  "favicon.svg": "<svg/>",
  "assets/index-a1.js": 'import"./zod-config-f6.js";import{a}from"./other.js";fetch("/api/info")',
  "assets/zod-config-f6.js": "globalThis.__zod_globalConfig={jitless:!0};",
  "assets/index-b2.css": '@font-face{src:url("/assets/Inter-c3.ttf")}',
  "assets/Inter-c3.ttf": "font",
  "licenses/Inter-OFL.txt": "OFL",
  "licenses/Ionicons-MIT.txt": "MIT",
  "assets/pdf-d4.js": 'GlobalWorkerOptions.workerSrc="/assets/pdf.worker.min-e5.js"',
  "assets/pdf.worker.min-e5.js": "class WorkerMessageHandler {}",
};

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("verifyDist", () => {
  it("accepts a complete artifact", () => {
    expect(verifyDist(site(good))).toEqual([]);
  });

  it("reports missing and relative assets, and a missing font or license", () => {
    const problems = verifyDist(
      site({
        ...good,
        "index.html": '<script src="assets/index-a1.js"></script><link href="/assets/gone.css">',
        "assets/index-b2.css": '@font-face{src:url("./Inter-c3.ttf")}',
        "assets/Inter-c3.ttf": "",
        "licenses/Inter-OFL.txt": "",
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "index.html reference is not root-absolute: assets/index-a1.js",
        "index.html references a missing file: /assets/gone.css",
        "assets/index-b2.css url() is not root-absolute: ./Inter-c3.ttf",
      ]),
    );
  });

  it("reports third-party URLs and leaked server configuration", () => {
    const problems = verifyDist(
      site({
        ...good,
        "index.html": `${good["index.html"]}<script src="https://cdn.example.com/x.js"></script>`,
        "assets/index-a1.js": 'const a="postgres://penny:secret@db/penny";const b="Host=db;Port=5432;Database=penny";const c="http://127.0.0.1:8080"',
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "index.html loads a third-party URL: https://cdn.example.com/x.js",
        "assets/index-a1.js contains a PostgreSQL URL",
        "assets/index-a1.js contains a connection string",
        "assets/index-a1.js contains a development server address",
      ]),
    );
  });

  it("requires one pdf.js worker, emitted as .js and referenced by the bundle (MAZ-94)", () => {
    const { "assets/pdf.worker.min-e5.js": worker, ...rest } = good;
    expect(verifyDist(site({ ...rest, "assets/pdf.worker.min-e5.mjs": worker, "assets/pdf-d4.js": 'workerSrc="/assets/pdf.worker.min-e5.mjs"' }))).toEqual(
      expect.arrayContaining(["assets/pdf.worker.min-e5.mjs must be emitted as .js", "dist/ contains .mjs files, which some servers send without a JavaScript type"]),
    );
    rmSync(root, { recursive: true, force: true });
    expect(verifyDist(site({ ...good, "assets/pdf-d4.js": "no worker here" }))).toEqual(["no bundle references the pdf.js worker at /assets/pdf.worker.min-e5.js"]);
    rmSync(root, { recursive: true, force: true });
    expect(verifyDist(site(rest))).toEqual(["expected one pdf.js worker in assets/, found 0"]);
  });

  it("requires the entry to load the Zod config chunk before anything else", () => {
    expect(verifyDist(site({ ...good, "assets/index-a1.js": 'import{a}from"./other.js";import"./zod-config-f6.js";' }))).toEqual(["the entry script must import the zod-config chunk first (src/app/zodConfig.ts)"]);
  });

  it("lets the bundler's import-free runtime chunk load before the Zod config, and nothing else", () => {
    const runtime = "var e=Object.create;export{e as a};";
    const entry = 'import{a as e}from"./rolldown-runtime-r1.js";import"./zod-config-f6.js";import{a}from"./other.js";';
    expect(verifyDist(site({ ...good, "assets/index-a1.js": entry, "assets/rolldown-runtime-r1.js": runtime }))).toEqual([]);
    expect(verifyDist(site({ ...good, "assets/index-a1.js": entry, "assets/rolldown-runtime-r1.js": 'import"./schemas-z1.js";' + runtime }))).toEqual([
      "the entry script must import the zod-config chunk first (src/app/zodConfig.ts)",
    ]);
  });

  it("fails clearly when the build has not run", () => {
    expect(verifyDist(site({}))[0]).toMatch(/missing .*index\.html/);
  });
});
