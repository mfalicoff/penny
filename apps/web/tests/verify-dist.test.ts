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
  "index.html": '<link rel="icon" href="/favicon.svg"><script src="/assets/index-a1.js"></script><link href="/assets/index-b2.css">',
  "favicon.svg": "<svg/>",
  "assets/index-a1.js": "fetch('/api/info')",
  "assets/index-b2.css": '@font-face{src:url("/assets/Inter-c3.ttf")}',
  "assets/Inter-c3.ttf": "font",
  "licenses/Inter-OFL.txt": "OFL",
  "licenses/Ionicons-MIT.txt": "MIT",
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

  it("fails clearly when the build has not run", () => {
    expect(verifyDist(site({}))[0]).toMatch(/missing .*index\.html/);
  });
});
