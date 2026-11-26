// Re-captures the product page's screenshots (src/assets/screens):
//
// - web-*.png: the real web app in its demo (sample data, no account, no server), dark, 2×.
//   Needs the web app's dev server and Playwright: see scripts/demo.ts.
// - iphone-*.png: the native app's committed design renders (docs/design/penny-ios/previews,
//   dark), cropped to the screen. Linux can't run the iOS simulator.
//
//   PENNY_WEB_ORIGIN=http://localhost:<port> node apps/site/scripts/capture-screens.ts [out-dir]
//   (out-dir defaults to /tmp/penny-screens)
//
// Then convert to WebP (vips is in nixpkgs):
//   vips copy out/web-home.png apps/site/src/assets/screens/web-home.webp[Q=86]
//   vips thumbnail out/web-home.png apps/site/src/assets/screens/web-home-1440.webp[Q=84] 1440
//   vips crop docs/design/penny-ios/previews/iphone-home.dark.png out/iphone-home.png 80 80 804 1748
//
// The clips of the apps in use have their own capture: video/capture/web.ts.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { hideDemoBanner, openDemo } from "./demo.ts";

const out = resolve(process.argv[2] ?? "/tmp/penny-screens");
mkdirSync(out, { recursive: true });

const { browser, page } = await openDemo();
for (const [name, href] of [["home", "/"], ["insights", "/insights"]] as const) {
  if (href !== "/") await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForTimeout(1500);
  await hideDemoBanner(page);
  await page.screenshot({ path: join(out, `web-${name}.png`) });
  console.log(join(out, `web-${name}.png`));
}
await browser.close();
