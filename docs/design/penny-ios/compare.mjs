// Builds the side-by-side review sheets for the visual comparison (MAZ-122,
// docs/design/visual-acceptance.md): for each card and appearance, the baseline next to the iOS
// and web captures.
//
//   node docs/design/penny-ios/compare.mjs [id filter] [--ios DIR] [--web DIR] [--out DIR]
//
// Captures come from the card capture runs: test-results/cards/ios/ (XCUITest, `ios.sh ui-test
// cards`) and test-results/cards/web/ (Playwright, `npm run test:e2e:cards` in apps/web), each with
// a report.json of { id, appearance, status, file, note }. Writes test-results/cards/comparison/
// <id>.png and index.html, and lists every card whose record in contracts/visual-comparisons.json
// disagrees with what was captured (for example, recorded as matching but not captured).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "../../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : resolve(args[at + 1]);
};
const filter = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "";
const dirs = { ios: option("ios", join(repo, "test-results/cards/ios")), web: option("web", join(repo, "test-results/cards/web")) };
const out = option("out", join(repo, "test-results/cards/comparison"));

let playwright;
try {
  playwright = await import("playwright");
} catch {
  playwright = createRequire(join(repo, "apps/web/package.json"))("playwright");
}

const manifest = JSON.parse(readFileSync(join(root, "previews/manifest.json"), "utf8"));
const record = JSON.parse(readFileSync(join(repo, "contracts/visual-comparisons.json"), "utf8"));
const reports = Object.fromEntries(Object.entries(dirs).map(([platform, dir]) => {
  const path = join(dir, "report.json");
  return [platform, existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : []];
}));
const capture = (platform, id, appearance) => reports[platform].find((r) => r.id === id && r.appearance === appearance);

const escape = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cell = (title, image, note) => `<figure><figcaption>${escape(title)}</figcaption>${
  image ? `<img src="${pathToFileURL(image).href}">` : `<div class="none">${escape(note)}</div>`}</figure>`;

function sheet(card) {
  const entry = record.cards.find((c) => c.id === card.id);
  const rows = card.images.map((image) => {
    const cells = [cell(`Design · ${image.appearance}`, join(root, image.file), "no baseline")];
    for (const platform of ["ios", "web"]) {
      const side = entry?.[platform === "ios" ? "native" : "web"];
      if (side?.status === "not-applicable") continue;
      const found = capture(platform, card.id, image.appearance);
      const file = found?.status === "captured" ? join(dirs[platform], found.file ? found.file.split("/").pop() : `${card.id}.${image.appearance}.png`) : null;
      cells.push(cell(`${platform === "ios" ? "iOS" : "Web"} · ${found?.status ?? "not captured"}`, file && existsSync(file) ? file : null, found?.note ?? "no capture in this run"));
    }
    return `<div class="row">${cells.join("")}</div>`;
  });
  const verdict = (side) => side ? `${side.status}${side.deviations?.length ? ` · ${side.deviations.length} deviation(s)` : ""}` : "no record";
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; font: 14px/1.4 system-ui, sans-serif; background: #F2F1EE; color: #16120F; }
    h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 16px; color: #6F6A64; }
    .row { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
    figure { margin: 0; } figcaption { font-weight: 600; margin-bottom: 6px; }
    img { height: 720px; width: auto; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.15); display: block; }
    .none { height: 720px; width: 330px; display: grid; place-items: center; padding: 24px; box-sizing: border-box; text-align: center;
      border: 2px dashed #A9A49D; border-radius: 8px; color: #6F6A64; }
  </style><h1>${escape(card.id)}</h1><p>${escape(entry?.view ?? "")} · native: ${escape(verdict(entry?.native))} · web: ${escape(verdict(entry?.web))}</p>${rows.join("")}`;
}

mkdirSync(out, { recursive: true });
const browser = await playwright.chromium.launch();
const cards = manifest.cards.filter((card) => card.id.includes(filter));
for (const card of cards) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const html = join(out, `${card.id}.html`);
  writeFileSync(html, sheet(card));
  await page.goto(pathToFileURL(html).href);
  await page.waitForLoadState("load");
  await page.screenshot({ path: join(out, `${card.id}.png`), fullPage: true });
  await page.close();
  console.log("sheet", relative(repo, join(out, `${card.id}.png`)));
}
await browser.close();

writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Penny visual comparison</title>
<style>body{font:14px system-ui,sans-serif;padding:24px} td,th{padding:4px 12px;text-align:left} img{width:360px}</style>
<table><tr><th>Card</th><th>Native</th><th>Web</th><th>Sheet</th></tr>${cards.map((card) => {
  const entry = record.cards.find((c) => c.id === card.id);
  return `<tr><td>${escape(card.id)}</td><td>${escape(entry?.native.status)}</td><td>${escape(entry?.web.status)}</td><td><a href="${escape(card.id)}.png"><img src="${escape(card.id)}.png"></a></td></tr>`;
}).join("")}</table>`);

// The record must not claim more than the captures show.
const reviewed = new Set(["matches", "deviates"]);
let mismatches = 0;
for (const card of cards) {
  const entry = record.cards.find((c) => c.id === card.id);
  for (const [platform, side] of [["ios", entry?.native], ["web", entry?.web]]) {
    if (!side || !reviewed.has(side.status) || !reports[platform].length) continue;
    for (const image of card.images) {
      const found = capture(platform, card.id, image.appearance);
      if (found?.status !== "captured") {
        mismatches++;
        console.log(`record says ${card.id} ${platform} ${side.status}, but ${image.appearance} is ${found?.status ?? "not captured"}`);
      }
    }
  }
}
console.log(`wrote ${relative(repo, join(out, "index.html"))}${mismatches ? `; ${mismatches} record(s) disagree with the captures` : ""}`);
