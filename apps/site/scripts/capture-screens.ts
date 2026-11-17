// Re-captures the product page's screenshots (src/assets/screens):
//
// - web-*.png: the real web app in its demo (sample data, no account, no server), dark, 2×.
//   Needs the web app's dev server: `npm --prefix apps/web run dev -- --port 5199`.
// - iphone-*.png: the native app's committed design renders (docs/design/penny-ios/previews,
//   dark), cropped to the screen. The demo can't show shared households or trips, and Linux
//   can't run the iOS simulator.
//
//   node apps/site/scripts/capture-screens.ts [out-dir]          (default /tmp/penny-screens)
//
// Then convert to WebP (vips is in nixpkgs):
//   vips copy out/web-home.png apps/site/src/assets/screens/web-home.webp[Q=86]
//   vips thumbnail out/web-home.png apps/site/src/assets/screens/web-home-1440.webp[Q=84] 1440
//   vips crop docs/design/penny-ios/previews/iphone-home.dark.png out/iphone-home.png 80 80 804 1748
//
// Playwright comes from apps/web (`npm --prefix apps/web ci`). On NixOS set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE to a system Chromium, as for the web app's end-to-end tests.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../../..");
const out = resolve(process.argv[2] ?? "/tmp/penny-screens");
const origin = process.env.PENNY_WEB_ORIGIN ?? "http://localhost:5199";
mkdirSync(out, { recursive: true });

const { chromium } = createRequire(join(repository, "apps/web/package.json"))("playwright");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await context.newPage();

// The demo runs entirely in the tab; answer the few calls made before it starts as a server
// with no session and no OIDC would.
await page.route(
  (url: URL) => url.pathname.startsWith("/api/"),
  (route: { request(): { url(): string }; fulfill(response: object): Promise<void> }) => {
    const url = route.request().url();
    const json = (status: number, body: object) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.endsWith("/api/info")) return json(200, { name: "penny", version: "2.0.0" });
    if (url.endsWith("/api/auth/oidc")) return json(200, { enabled: false });
    return json(401, { title: "Unauthorized", status: 401 });
  },
);

await page.goto(origin);
await page.getByRole("button", { name: "Explore a demo" }).click();
await page.waitForTimeout(2000);

for (const [name, href] of [["home", "/"], ["insights", "/insights"]] as const) {
  if (href !== "/") await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForTimeout(1500);
  // The "You're exploring a demo" banner is true in the demo but noise on the product page.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const height = el.getBoundingClientRect().height;
      if (el.children.length < 6 && /You're exploring a demo/.test(el.textContent ?? "") && height > 40 && height < 200) {
        el.style.display = "none";
        break;
      }
    }
  });
  await page.screenshot({ path: join(out, `web-${name}.png`) });
  console.log(join(out, `web-${name}.png`));
}
await browser.close();
