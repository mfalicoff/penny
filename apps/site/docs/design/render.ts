// Renders the product page design cards (cards/*.html) to previews/<card>.jpg, full page.
//
//   node apps/site/docs/design/render.ts [card...]      (default: every card)
//
// Icons are written `<i data-icon="name"></i>` as on the page itself, and inlined here from
// design-kit/src/icons.ts. Playwright comes from apps/web (`npm --prefix apps/web ci`); on NixOS
// set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a system Chromium.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ICON_SVG, type IconName } from "../../../../design-kit/src/icons.ts";

const here = import.meta.dirname;
const repository = resolve(here, "../../../..");
const cards = join(here, "cards");
const WIDTHS: Record<string, number> = { desktop: 1440, phone: 390 };

const requested = process.argv.slice(2);
const names = readdirSync(cards)
  .filter((file) => file.endsWith(".html") && !file.startsWith("."))
  .map((file) => file.replace(/\.html$/, ""))
  .filter((name) => requested.length === 0 || requested.includes(name));

const { chromium } = createRequire(join(repository, "apps/web/package.json"))("playwright");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
for (const name of names) {
  const html = readFileSync(join(cards, `${name}.html`), "utf8").replace(/<i data-icon="([a-z-]+)"><\/i>/g, (_, icon: string) => {
    const svg = ICON_SVG[icon as IconName];
    if (!svg) throw new Error(`${name}: unknown icon "${icon}" (see design-kit/src/icons.ts)`);
    return `<svg class="icon" viewBox="0 0 512 512" aria-hidden="true">${svg}</svg>`;
  });
  const temporary = join(cards, `.render-${name}.html`);
  writeFileSync(temporary, html);
  try {
    const width = WIDTHS[name] ?? 1440;
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(temporary).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const out = join(here, "previews", `${name}.jpg`);
    await page.screenshot({ path: out, fullPage: true, type: "jpeg", quality: 88 });
    console.log(out);
    await page.close();
  } finally {
    rmSync(temporary, { force: true });
  }
}
await browser.close();
