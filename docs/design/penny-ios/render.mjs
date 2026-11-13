// Renders every card to its visual acceptance baselines (MAZ-122):
// previews/<id>.<appearance>.png and previews/manifest.json.
//
//   node docs/design/penny-ios/render.mjs [scale] [id filter]          # write baselines (scale 2)
//   node docs/design/penny-ios/render.mjs [scale] [id filter] --check  # re-render and compare
//
// <id> is the card's contract id (`<folder>-<file>`, contracts/design-baseline.json). Each card
// is rendered in the appearances contracts/fixtures/redesign-states.json lists for it (light and
// dark, or the one a card pins). Dark adds the `dark` class to every document, including the
// screens sheets embed in iframes, before any card script runs. The bundled Inter replaces the
// system font stack (and monospace runs, with tabular figures), so the output doesn't depend on
// the machine's fonts.
//
// --check renders into memory and compares with the committed PNGs: it fails when an image is
// missing, its size differs, or more than PENNY_BASELINE_TOLERANCE (default 0.005) of its pixels
// differ by more than a small per-channel threshold. The comparison runs at a quarter of the
// resolution, which absorbs glyph antialiasing differences between macOS and Linux. It writes the renders that fail to test-results/design-baselines/.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "../../..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const [scaleArg, filter = ""] = args.filter((a) => !a.startsWith("--"));
const scale = Number(scaleArg ?? 2);
const tolerance = Number(process.env.PENNY_BASELINE_TOLERANCE ?? 0.005);
const out = join(root, "previews");
const failures = join(repo, "test-results/design-baselines");

// Playwright from the repository root, or else from apps/web (`npm ci` there installs it).
let playwright;
try {
  playwright = await import("playwright");
} catch {
  playwright = createRequire(join(repo, "apps/web/package.json"))("playwright");
}
const { chromium } = playwright;
mkdirSync(out, { recursive: true });

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const states = JSON.parse(readFileSync(join(repo, "contracts/fixtures/redesign-states.json"), "utf8")).states;
const appearancesOf = new Map(states.map((s) => [s.specimen, s.appearances]));

const cards = ["system", "iphone", "ipad", "web"]
  .flatMap((dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".html")).sort().map((f) => join(dir, f)))
  .map((file) => {
    const html = readFileSync(join(root, file), "utf8");
    const [w, h] = (html.split("\n", 1)[0].match(/viewport="(\d+)x(\d+)"/)?.slice(1) ?? [1200, 900]).map(Number);
    const id = file.replace("/", "-").replace(".html", "");
    const appearances = appearancesOf.get(id);
    if (!appearances) throw new Error(`${id}: no state in contracts/fixtures/redesign-states.json`);
    return { id, file, viewport: { w, h }, sha256: sha256(html), appearances };
  });
const selected = cards.filter((c) => c.id.includes(filter));

// The shared assets every card loads; a change to one invalidates every baseline.
const assets = readdirSync(join(root, "assets")).sort()
  .map((f) => ({ path: `assets/${f}`, sha256: sha256(readFileSync(join(root, "assets", f))) }));

// Use Playwright's Chromium, or PENNY_DESIGN_CHROME, or a Nix-store Google Chrome.
let executablePath = process.env.PENNY_DESIGN_CHROME;
if (!executablePath && existsSync("/nix/store") && !existsSync(chromium.executablePath())) {
  executablePath = readdirSync("/nix/store").filter((n) => /google-chrome-.*\d/.test(n)).sort().reverse()
    .map((n) => `/nix/store/${n}/share/google/chrome/chrome`).find((p) => existsSync(p));
}
const browser = await chromium.launch({ args: ["--no-sandbox", "--font-render-hinting=none"], ...(executablePath ? { executablePath } : {}) });

// Runs in every frame before its scripts: pins the preview font and, for dark, the theme class.
function prepare(dark) {
  const apply = () => {
    const html = document.documentElement;
    if (!html) return false;
    if (dark) html.classList.add("dark");
    const style = document.createElement("style");
    style.textContent = `:root, .dark { --font: "PennyPreview", sans-serif !important; }
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      ${dark ? "html.dark, body.canvas { background: #1b1a19; }" : ""}`;
    html.appendChild(style);
    return true;
  };
  if (!apply()) {
    const observer = new MutationObserver(() => apply() && observer.disconnect());
    observer.observe(document, { childList: true });
  }
}

async function render(card, appearance) {
  const context = await browser.newContext({
    viewport: { width: card.viewport.w, height: card.viewport.h },
    deviceScaleFactor: scale,
    colorScheme: appearance,
    reducedMotion: "reduce",
  });
  await context.addInitScript(prepare, appearance === "dark");
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(root, card.file)).href, { waitUntil: "load" });
  // System monospace fonts differ by OS (SF Mono, DejaVu Sans Mono…): draw those runs in the
  // bundled Inter with tabular figures instead.
  for (const frame of page.frames()) {
    await frame.evaluate(async () => {
      for (const el of document.querySelectorAll("*")) {
        if (/monospace/.test(getComputedStyle(el).fontFamily)) {
          el.style.setProperty("font-family", '"PennyPreview", sans-serif', "important");
          el.style.setProperty("font-variant-numeric", "tabular-nums", "important");
        }
      }
      await document.fonts.ready;
    });
  }
  const png = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
  await context.close();
  return png;
}

// Compares two PNGs in the browser (no image dependencies): the share of pixels, at a quarter
// of the resolution, whose channels differ by more than 24 of 255.
async function compare(expected, actual) {
  const page = await browser.newPage();
  const result = await page.evaluate(async ([a, b]) => {
    const load = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return { size: `${x.width}x${x.height} → ${y.width}x${y.height}` };
    // Downsampled 4x with smoothing, so glyph-edge antialiasing (which differs between macOS
    // and Linux) averages out while layout, color and copy changes still show.
    const w = Math.ceil(x.width / 4), h = Math.ceil(x.height / 4);
    const pixels = (img) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const [p, q] = [pixels(x), pixels(y)];
    let diff = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (Math.abs(p[i] - q[i]) > 24 || Math.abs(p[i + 1] - q[i + 1]) > 24 || Math.abs(p[i + 2] - q[i + 2]) > 24) diff++;
    }
    return { ratio: diff / (p.length / 4) };
  }, [expected.toString("base64"), actual.toString("base64")]);
  await page.close();
  return result;
}

const images = [];
let failed = 0;
if (check) rmSync(failures, { recursive: true, force: true });
for (const card of selected) {
  for (const appearance of card.appearances) {
    const name = `${card.id}.${appearance}.png`;
    const png = await render(card, appearance);
    if (check) {
      const path = join(out, name);
      const result = existsSync(path) ? await compare(readFileSync(path), png) : { missing: true };
      const ok = !result.missing && !result.size && result.ratio <= tolerance;
      if (!ok) {
        failed++;
        mkdirSync(failures, { recursive: true });
        writeFileSync(join(failures, name), png);
      }
      const detail = result.missing ? "missing" : result.size ? `size ${result.size}` : `${(result.ratio * 100).toFixed(3)}% of pixels differ`;
      console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
    } else {
      writeFileSync(join(out, name), png);
      images.push({ id: card.id, appearance, file: `previews/${name}`, sha256: sha256(png) });
      console.log("rendered", relative(repo, join(out, name)));
    }
  }
}
await browser.close();

if (check) {
  console.log(failed ? `${failed} baseline(s) differ; renders are in ${relative(repo, failures)}` : "every baseline matches");
  process.exit(failed ? 1 : 0);
}

// The manifest ties each image to the card source and assets it was rendered from, so
// tests/core/contracts.test.ts can tell a stale baseline without rendering. A filtered run
// replaces only the entries it rendered.
const manifestPath = join(out, "manifest.json");
const previous = existsSync(manifestPath) && filter ? JSON.parse(readFileSync(manifestPath, "utf8")).cards : [];
const rendered = new Map(images.map((i) => [`${i.id}.${i.appearance}`, i]));
const manifest = {
  version: 1,
  description: "Visual acceptance baselines for the redesign cards (MAZ-122). Regenerate with `node docs/design/penny-ios/render.mjs 2`; see docs/design/visual-acceptance.md.",
  scale,
  font: "Inter (assets/Inter.ttf) in place of SF Pro and of monospace (tabular figures); Ionicons in place of SF Symbols",
  assets,
  cards: cards.map((card) => {
    const old = previous.find((p) => p.id === card.id) ?? {};
    return {
      id: card.id,
      source: `docs/design/penny-ios/${card.file}`,
      sourceSha256: rendered.size && card.id.includes(filter) ? card.sha256 : old.sourceSha256,
      viewport: card.viewport,
      images: card.appearances.map((appearance) => {
        const image = rendered.get(`${card.id}.${appearance}`) ?? old.images?.find((i) => i.appearance === appearance);
        return image ? { appearance, file: image.file, sha256: image.sha256 } : { appearance, file: null, sha256: null };
      }),
    };
  }),
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("wrote", relative(repo, manifestPath));
