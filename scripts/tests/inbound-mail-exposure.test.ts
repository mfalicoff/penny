// The Email Worker's endpoints (MAZ-184) are never routed by the public web server. The
// API's routing is case-insensitive, so both nginx configurations must refuse every
// case variant of /api/inbound-mail (a regex location wins over the /api/ prefix).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Compose nginx refuses /api/inbound-mail in any letter case", () => {
  const template = read("deploy/web/default.conf.template");
  assert.match(template, /location ~\* \^\/api\/inbound-mail\(\/\|\$\) \{\s+default_type application\/json;\s+return 404/);
  assert.doesNotMatch(template, /location \^~ \/api\/inbound-mail/);
});

test("NixOS nginx refuses /api/inbound-mail in any letter case", () => {
  const module = read("nix/module.nix");
  assert.match(module, /"~\* \^\/api\/inbound-mail\(\/\|\$\)" = \{\s+extraConfig = ''\s+default_type application\/json;\s+return 404/);
});
