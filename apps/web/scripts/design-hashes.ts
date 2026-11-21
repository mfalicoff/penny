// Rewrites the file hashes in contracts/design-baseline.json from the files on disk: each card's
// `sha256` (its `sourcePath`), each control's (its `docPath`) and every `sources` entry. Run it
// after changing a card, a design-kit doc or a traced source such as docs/design/visual-acceptance.md,
// and to resolve a conflict on those hashes after a rebase: take either side, then run it again.
// tests/domain/contracts.test.ts stays the check. Run from apps/web: npm run design:hashes.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const baselinePath = fileURLToPath(new URL("contracts/design-baseline.json", root));

interface Hashed {
  sha256: string;
}
interface Baseline {
  specimens: (Hashed & { sourcePath: string })[];
  controls: (Hashed & { docPath: string })[];
  sources: (Hashed & { path: string })[];
}

/** Sets every hash in the baseline from `hash(path)`, and returns the paths whose hash changed. */
export function rehash(baseline: Baseline, hash: (path: string) => string): string[] {
  const changed: string[] = [];
  const set = (item: Hashed, path: string) => {
    const next = hash(path);
    if (item.sha256 !== next) changed.push(path);
    item.sha256 = next;
  };
  for (const item of baseline.specimens) set(item, item.sourcePath);
  for (const item of baseline.controls) set(item, item.docPath);
  for (const item of baseline.sources) set(item, item.path);
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  const changed = rehash(baseline, (path) => createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex"));
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(changed.length === 0 ? "design-baseline.json hashes are up to date" : `updated ${String(changed.length)} hash(es) in contracts/design-baseline.json:\n${changed.map((path) => `  ${path}`).join("\n")}`);
}
