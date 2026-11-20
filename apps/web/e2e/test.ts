import { test as base, type Request } from "@playwright/test";

export { expect } from "@playwright/test";

/** How long /api must stay quiet before a test may close its pages. */
const QUIET_MS = 500;
/** A request still open after this long is left alone: the test ends anyway. */
const SETTLE_LIMIT_MS = 5_000;

/**
 * The mocked specs' `test` (MAZ-210). After each test body it waits until the test's own context
 * has no /api request open and none started for QUIET_MS, before Playwright closes the pages.
 *
 * Closing a page drops its routes first. A request the app sends in that moment, such as the
 * offline store's follow-up ledger sync right after a page loads, then goes past every mock to
 * `vite preview`'s /api proxy, which has no API behind it in mocked runs and logs
 * "http proxy error". WebKit is slow enough to hit this often. That noise hides a request a spec
 * really forgot to mock, so the proxy log should stay empty.
 *
 * Contexts a test opens itself (`browser.newContext()`) are closed by that test and aren't
 * covered here.
 */
export const test = base.extend<{ settledApi: undefined }>({
  settledApi: [
    async ({ context }, use) => {
      const open = new Set<Request>();
      let lastActivity = 0;
      const isApi = (request: Request) => new URL(request.url()).pathname.startsWith("/api/");
      const started = (request: Request) => {
        if (!isApi(request)) return;
        open.add(request);
        lastActivity = Date.now();
      };
      const ended = (request: Request) => {
        if (open.delete(request)) lastActivity = Date.now();
      };
      context.on("request", started);
      context.on("requestfinished", ended);
      context.on("requestfailed", ended);

      await use(undefined);

      const deadline = Date.now() + SETTLE_LIMIT_MS;
      while (Date.now() < deadline && (open.size > 0 || Date.now() - lastActivity < QUIET_MS)) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      context.off("request", started);
      context.off("requestfinished", ended);
      context.off("requestfailed", ended);
    },
    { auto: true },
  ],
});
