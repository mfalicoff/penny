// Renders every proposal card to previews/<group>-<name>.png.
// Usage: node docs/design/penny-ios/render.mjs [scale] [file filter]
import { chromium } from "playwright";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const scale = Number(process.argv[2] ?? 2);
const filter = process.argv[3] ?? "";
const files = ["system", "iphone", "ipad"].flatMap((dir) =>
  readdirSync(join(root, dir)).filter((f) => f.endsWith(".html")).map((f) => join(dir, f)),
).filter((f) => f.includes(filter));

// Use Playwright's Chromium, or PENNY_DESIGN_CHROME, or a Nix-store Google Chrome.
let executablePath = process.env.PENNY_DESIGN_CHROME;
if (!executablePath && existsSync("/nix/store")) {
  executablePath = readdirSync("/nix/store").filter((n) => /google-chrome-.*\d/.test(n)).sort().reverse()
    .map((n) => `/nix/store/${n}/share/google/chrome/chrome`).find((p) => existsSync(p));
}
const browser = await chromium.launch({ args: ["--no-sandbox"], ...(executablePath ? { executablePath } : {}) });
for (const file of files) {
  const head = readFileSync(join(root, file), "utf8").split("\n", 1)[0];
  const [w, h] = (head.match(/viewport="(\d+)x(\d+)"/)?.slice(1) ?? [1200, 900]).map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(join(root, file)).href);
  await page.evaluate(() => document.fonts.ready);
  const out = join(root, "previews", file.replace("/", "-").replace(".html", ".png"));
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  console.log("rendered", out);
}
await browser.close();
