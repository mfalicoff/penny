import { test as base, type Request } from "@playwright/test";

export { expect } from "@playwright/test";

/** How long /api must stay quiet before a test may close its pages. */
const QUIET_MS = 500;
/** A request still open after this long is left alone: the test ends anyway. */
const SETTLE_LIMIT_MS = 5_000;
/** The status the guard answers an unmocked /api request with: no real server sends it. */
export const UNMOCKED_STATUS = 599;

export interface MockedApi {
  /** Unmocked /api requests so far, as "METHOD /path". */
  unmocked: string[];
}

/**
 * The mocked specs' `test`. Its automatic `mockedApi` fixture does two things for the test's own
 * context:
 *
 * 1. Fails the test when no mock answered an /api request (MAZ-211). Before the test body runs,
 *    the fixture registers a context route for every /api path. Playwright tries the most recently
 *    registered route first, and page routes before context routes, so every mock a spec
 *    registers (one path at a time or a catch-all) still wins. A request none of them answers, or
 *    one a mock passes on with `route.fallback()`, reaches this guard instead of `vite preview`'s
 *    /api proxy, which has no API behind it in mocked runs. The guard answers it with status 599,
 *    so the app sees a failure instead of waiting, and after the test it fails the test with the
 *    list of unmocked requests. Without the guard, an endpoint a spec forgot to mock only logs
 *    "http proxy error" in the web server output and never fails a test.
 *
 * 2. After each test body, waits until the context has no /api request open and none started for
 *    QUIET_MS, before Playwright closes the pages (MAZ-210). Closing a page drops its routes first.
 *    A request the app sends in that moment, such as the offline store's follow-up ledger sync
 *    right after a page loads, would then miss the spec's page mocks. WebKit is slow enough to
 *    hit this often.
 *
 * The fixture's value lists the unmocked requests so far. A spec that sends one on purpose (only
 * the guard's own spec) checks the list and empties it.
 *
 * Contexts a test opens itself (`browser.newContext()`) are closed by that test and aren't
 * covered here.
 */
export const test = base.extend<{ mockedApi: MockedApi }>({
  mockedApi: [
    async ({ context }, use) => {
      const unmocked: string[] = [];
      await context.route("**/api/**", (route) => {
        const request = route.request();
        unmocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
        return route.fulfill({ status: UNMOCKED_STATUS, json: { error: "No e2e mock answered this request." } });
      });

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

      await use({ unmocked });

      const deadline = Date.now() + SETTLE_LIMIT_MS;
      while (Date.now() < deadline && (open.size > 0 || Date.now() - lastActivity < QUIET_MS)) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      context.off("request", started);
      context.off("requestfinished", ended);
      context.off("requestfailed", ended);

      if (unmocked.length > 0) {
        const lines = [...new Set(unmocked)].map((line) => `  ${line}`).join("\n");
        throw new Error(`No mock answered ${unmocked.length} /api request(s). Mock them in the spec:\n${lines}`);
      }
    },
    { auto: true },
  ],
});
