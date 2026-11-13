import { expect, test, type Page } from "@playwright/test";
import { enterDemo, horizontalOverflow, navigate, startDemo } from "./demo";

// MAZ-96 responsive and theme visual regression over the demo (fixed clock, in-memory sample
// data, bundled Inter): sign-in, Home, Activity, Trips and Settings at 320, 768 and 1440px in
// light and dark. Every capture also asserts no horizontal scrolling. Screenshots depend on the
// OS's text rasterization, so the committed baselines (e2e/visual.spec.ts-snapshots/, suffixed
// with the platform) are compared only when PENNY_VISUAL=1, on the chromium-desktop project:
//
//   PENNY_VISUAL=1 npx playwright test visual --project=chromium-desktop
//   PENNY_VISUAL=1 npx playwright test visual --project=chromium-desktop --update-snapshots   # after an intended change
//
// These are regression baselines for the web app itself. The comparison with the design cards is
// cards.real.spec.ts (MAZ-122, docs/design/visual-acceptance.md).
test.skip(process.env.PENNY_VISUAL !== "1", "visual baselines are compared with PENNY_VISUAL=1");
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "baselines are recorded on chromium-desktop");

const WIDTHS = [320, 768, 1440] as const;
const PAGES = ["Home", "Activity", "Trips", "Settings"] as const;

async function capture(page: Page, name: string) {
  expect(await horizontalOverflow(page), `${name}: horizontal scrolling`).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false, maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" });
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`${colorScheme} at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 720 : 900 });
      await startDemo(page, { colorScheme });
      await capture(page, `sign-in-${colorScheme}-${String(width)}`);
      await enterDemo(page);
      for (const name of PAGES) {
        await navigate(page, name);
        await capture(page, `${name.toLowerCase()}-${colorScheme}-${String(width)}`);
      }
    });
  }
}
