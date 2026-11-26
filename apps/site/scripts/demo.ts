// Opens the web app's demo (sample data in the tab, no account, no server) for the product
// page's captures: scripts/capture-screens.ts (stills) and video/capture/web.ts (clips).
//
// Needs the web app's dev server (`npm --prefix apps/web run dev` prints its port; pass it as
// PENNY_WEB_ORIGIN) and Playwright from apps/web (`npm --prefix apps/web ci`). On NixOS set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE to a system Chromium, as for the web app's end-to-end tests.
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../../..");

export const origin = process.env.PENNY_WEB_ORIGIN ?? "http://localhost:4173";

/** Opens the demo in the dark appearance at 1440 × 900, 2×, as the product page shows it. */
export async function openDemo() {
  // Playwright comes from apps/web, untyped here: the captures use a handful of its calls.
  const { chromium } = createRequire(join(repository, "apps/web/package.json"))("playwright");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  // The emulated 2× alone gives screenshots at 2× but screencast frames (the clips) at 1×.
  const args = ["--force-device-scale-factor=2"];
  const browser = await chromium.launch(executablePath ? { executablePath, args } : { args });
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
  await page.getByRole("button", { name: "Take a look around with sample data" }).click();
  await page.waitForTimeout(2000);
  return { browser, context, page };
}

/** Hides the "You're exploring a demo" banner: true in the demo, but noise on the product page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Playwright page, see openDemo
export async function hideDemoBanner(page: any): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const height = el.getBoundingClientRect().height;
      if (el.children.length < 6 && /You're exploring a demo/.test(el.textContent ?? "") && height > 40 && height < 200) {
        el.style.display = "none";
        break;
      }
    }
  });
}
