// Records the web clips (Insights, Apps) from the web app's demo: sample data, no account.
//
//   PENNY_WEB_ORIGIN=http://localhost:<port> node capture/web.ts [clip...]   (default: every web clip)
//
// Needs the web app's dev server and Playwright from apps/web; see ../scripts/demo.ts.
//
// Each clip is written to captures/<clip>/ (gitignored) in the format every capture shares,
// iOS included (see ../docs/product-videos.md):
//   frames/000000.jpg …   the screen at 2×, one file per change (Chromium's screencast)
//   capture.json          { width, height, scale, duration, frames: [{ t, file }], events }
// `events` names the moments the composition animates to, each with its time in seconds from
// the start and the box of the element involved, in CSS pixels of the 1440 × 900 viewport.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hideDemoBanner, openDemo } from "../../scripts/demo.ts";
import type { Capture, CaptureEvent } from "../src/capture.ts";

const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;
const root = resolve(import.meta.dirname, "../captures");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Playwright page (see openDemo)
type Page = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Playwright locator
type Locator = any;

interface Recorder {
  /** Seconds since the recording started. */
  now(): number;
  /** Records a named moment, with the element's box when there is one. */
  mark(name: string, target?: Locator): Promise<void>;
  /** Waits until `seconds` after the start, so the beats keep the storyboard's timing. */
  until(seconds: number): Promise<void>;
}

async function boxOf(target: Locator): Promise<CaptureEvent["box"]> {
  const box = await target.boundingBox();
  if (!box) throw new Error("The element to animate to isn't visible");
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/** Records the page from now until `script` resolves, as frames plus a timeline. */
async function record(page: Page, context: Page, clip: string, duration: number, script: (recorder: Recorder) => Promise<void>) {
  const dir = join(root, clip);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "frames"), { recursive: true });

  const session = await context.newCDPSession(page);
  const frames: Capture["frames"] = [];
  const events: Capture["events"] = {};
  let start = Number.POSITIVE_INFINITY;
  let pending: { data: string; at: number } | undefined;
  const write = (data: string, at: number) => {
    const file = `frames/${String(frames.length).padStart(6, "0")}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(data, "base64"));
    frames.push({ t: Math.max(0, at - start), file });
  };
  session.on("Page.screencastFrame", (frame: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
    void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    const at = frame.metadata.timestamp;
    // Keep the last frame from before the start: it's what the screen shows at 0 s.
    if (at < start) pending = { data: frame.data, at };
    else write(frame.data, at);
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: WIDTH * SCALE, maxHeight: HEIGHT * SCALE, everyNthFrame: 1 });
  await page.waitForTimeout(600);

  start = Date.now() / 1000;
  if (pending) write(pending.data, start);
  const now = () => Date.now() / 1000 - start;
  await script({
    now,
    async mark(name, target) {
      events[name] = { t: now(), ...(target ? { box: await boxOf(target) } : {}) };
    },
    async until(seconds) {
      const wait = (seconds - now()) * 1000;
      if (wait > 0) await page.waitForTimeout(wait);
    },
  });
  await page.waitForTimeout(Math.max(0, (duration - now()) * 1000) + 300);
  await session.send("Page.stopScreencast");
  if (frames.length === 0) throw new Error(`${clip}: the screencast sent no frames`);

  const capture: Capture = { width: WIDTH, height: HEIGHT, scale: SCALE, duration, frames, events };
  writeFileSync(join(dir, "capture.json"), JSON.stringify(capture, null, 2));
  console.log(`${clip}: ${frames.length} frames, ${Object.keys(events).join(", ")}`);
}

/** Insights: select Groceries, then Left over, in the money flow (storyboard: 7 s). */
async function insights(page: Page, context: Page) {
  await page.locator('a[href="/insights"]').first().click();
  await page.waitForTimeout(1500);
  await hideDemoBanner(page);
  await page.waitForTimeout(500);
  const flow = page.locator("svg").getByText("Groceries", { exact: true }).first();
  const leftOver = page.locator("svg").getByText("Left over", { exact: true }).first();
  const card = page.getByText("Follow your money", { exact: true }).first().locator("xpath=ancestor::section[1]");
  // The flow's hint reads "<band> selected · …" while a band is focused; a second click clears it.
  const toggle = async (label: Locator, selected: boolean) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await label.click({ force: true });
      await page.waitForTimeout(150);
      if ((await page.getByText(/ selected · /).count()) > 0 === selected) return;
    }
    throw new Error(`The money flow didn't ${selected ? "select" : "clear"} the band`);
  };
  await record(page, context, "insights", 7, async ({ mark, until }) => {
    await mark("start", card);
    await mark("left-over-label", leftOver);
    await until(1.6);
    await mark("groceries", flow);
    await toggle(flow, true);
    await until(3.4);
    await toggle(flow, false);
    await until(3.6);
    await mark("left-over", leftOver);
    await toggle(leftOver, true);
    await until(5.2);
    await mark("clear", leftOver);
    await toggle(leftOver, false);
    // Hovering a band also dims the others: move away so the clip ends as it starts.
    await page.mouse.move(1380, 860, { steps: 4 });
  });
}

/** Apps: search every entry from Home, see the matches, come back (storyboard: 6 s). */
async function apps(page: Page, context: Page) {
  await page.locator('a[href="/"]').first().click();
  await page.waitForTimeout(1500);
  await hideDemoBanner(page);
  await page.waitForTimeout(500);
  const search = page.getByPlaceholder("Search entries").first();
  const leftToSpend = page.getByText("Left to spend", { exact: true }).first().locator("xpath=..");
  await record(page, context, "apps", 6, async ({ mark, until }) => {
    await mark("start", leftToSpend);
    await until(1.3);
    await mark("search", search);
    await search.click({ position: { x: 18, y: 18 } });
    await page.keyboard.type("groc", { delay: 110 });
    await until(2.6);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await mark("results", page.locator("main").first());
    await until(4.4);
    const home = page.getByRole("navigation").getByRole("link", { name: /^Home/ }).first();
    await mark("home", home);
    await search.fill("");
    await home.click();
  });
}

const CLIPS = { insights, apps } as const;
const requested = process.argv.slice(2);
for (const name of requested) if (!(name in CLIPS)) throw new Error(`Unknown web clip "${name}" (${Object.keys(CLIPS).join(", ")})`);

const { browser, context, page } = await openDemo();
for (const [name, capture] of Object.entries(CLIPS)) {
  if (requested.length > 0 && !requested.includes(name)) continue;
  await capture(page, context);
}
await browser.close();
