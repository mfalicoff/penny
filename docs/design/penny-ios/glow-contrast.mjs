// Measures text contrast over the hero glow in every card that has one, in light and dark
// (MAZ-122, docs/design/visual-acceptance.md#contrast-on-the-hero-glow).
//
//   node docs/design/penny-ios/glow-contrast.mjs [id filter]
//
// For each text element that overlaps a `.glow`, it renders the card with all text hidden, reads
// the background pixels behind the element's own text, and takes the lowest WCAG contrast between the
// element's color and those pixels. Large text (24px, or 18.66px bold) needs 3:1, other text 4.5:1.
// Known shortfalls are listed in glow-contrast-known.json with the issue that fixes them; the
// script exits 1 on a shortfall that isn't listed, and on a listed one that now passes (remove it).
// --update rewrites the list from this run, keeping each entry's issue.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "../../..");
const args = process.argv.slice(2);
const update = args.includes("--update");
const filter = args.find((a) => !a.startsWith("--")) ?? "";
const knownPath = join(root, "glow-contrast-known.json");
const known = JSON.parse(readFileSync(knownPath, "utf8"));
const key = (f) => `${f.id} ${f.appearance} ${f.text}`;
const knownKeys = new Map(known.findings.map((f) => [key(f), f]));
const found = [];
let playwright;
try {
  playwright = await import("playwright");
} catch {
  playwright = createRequire(join(repo, "apps/web/package.json"))("playwright");
}

const cards = ["iphone", "ipad", "web"]
  .flatMap((dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".html")).sort().map((f) => join(dir, f)))
  .filter((file) => /class="glow/.test(readFileSync(join(root, file), "utf8")))
  .map((file) => ({ file, id: file.replace("/", "-").replace(".html", "") }))
  .filter((card) => card.id.includes(filter));

const browser = await playwright.chromium.launch();
let failures = 0;
for (const card of cards) {
  const [w, h] = (readFileSync(join(root, card.file), "utf8").split("\n", 1)[0].match(/viewport="(\d+)x(\d+)"/)?.slice(1) ?? [1200, 900]).map(Number);
  for (const dark of [false, true]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.addInitScript((isDark) => {
      document.addEventListener("DOMContentLoaded", () => {
        if (isDark) document.documentElement.classList.add("dark");
        const style = document.createElement("style");
        style.textContent = ':root, .dark { --font: "PennyPreview", sans-serif !important; }';
        document.head.appendChild(style);
      });
    }, dark);
    await page.goto(pathToFileURL(join(root, card.file)).href);
    await page.evaluate(() => document.fonts.ready);
    // Text runs (elements with their own text nodes) that sit over a glow.
    const texts = await page.evaluate(() => {
      const glows = [...document.querySelectorAll(".glow")].map((g) => g.getBoundingClientRect());
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const style = getComputedStyle(el);
        // The box of the element's own text, not its children (a dot or an amount beside it).
        const range = document.createRange();
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
        range.setStartBefore(own[0]);
        range.setEndAfter(own[own.length - 1]);
        const r = range.getBoundingClientRect();
        if (!r.width || !r.height || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
        if (el.closest(".island, .status, .glass, .tabbar, [class*='glass']")) continue; // glass controls carry their own surface
        if (!glows.some((g) => r.left < g.right && r.right > g.left && r.top < g.bottom && r.bottom > g.top)) continue;
        // Only text whose own box has no opaque background between it and the glow.
        let painted = false;
        for (let node = el; node && !node.classList?.contains("iphone") && !node.classList?.contains("ipad") && node !== document.body; node = node.parentElement) {
          const own = getComputedStyle(node);
          const filled = own.backgroundColor !== "rgba(0, 0, 0, 0)" && own.backgroundColor !== "transparent";
          if (filled || own.backgroundImage !== "none" || own.backdropFilter !== "none") { painted = true; break; }
        }
        if (painted) continue;
        const size = parseFloat(style.fontSize);
        const weight = Number(style.fontWeight);
        out.push({
          text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").slice(0, 40),
          color: style.color, opacity: Number(style.opacity),
          box: { x: r.left, y: r.top, w: r.width, h: r.height },
          large: size >= 24 || (size >= 18.66 && weight >= 700),
        });
      }
      return out;
    });
    await page.addStyleTag({ content: "* { color: transparent !important; -webkit-text-fill-color: transparent !important; } svg, [data-i] { visibility: hidden !important; }" });
    const shot = await page.screenshot();
    const results = await page.evaluate(async ([b64, items]) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const lum = ([r, g, b]) => {
        const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      return items.map((item) => {
        const m = item.color.match(/[\d.]+/g).map(Number);
        const { x, y, w, h } = item.box;
        const data = ctx.getImageData(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))).data;
        let worst = Infinity;
        for (let i = 0; i < data.length; i += 4) {
          const bg = [data[i], data[i + 1], data[i + 2]];
          const alpha = (m[3] ?? 1) * item.opacity;
          const fg = [0, 1, 2].map((k) => m[k] * alpha + bg[k] * (1 - alpha));
          worst = Math.min(worst, contrast(fg, bg));
        }
        return { ...item, contrast: worst };
      });
    }, [shot.toString("base64"), texts]);
    for (const r of results) {
      const need = r.large ? 3 : 4.5;
      const finding = { id: card.id, appearance: dark ? "dark" : "light", text: r.text, contrast: Number(r.contrast.toFixed(2)), needs: need };
      if (r.contrast >= need) {
        if (process.env.VERBOSE) console.log(`ok    ${key(finding)} ${finding.contrast}:1`);
        continue;
      }
      found.push(finding);
      const listed = knownKeys.get(key(finding));
      if (!listed) failures++;
      console.log(`${listed ? `known (${listed.issue})` : "FAIL "} ${key(finding)}: ${finding.contrast}:1, needs ${need}:1`);
    }
    console.log(`${card.id} ${dark ? "dark" : "light"}: ${results.length} text runs over the glow, lowest ${Math.min(...results.map((r) => r.contrast)).toFixed(2)}:1`);
    await page.close();
  }
}
await browser.close();

const now = new Set(found.map(key));
const fixed = known.findings.filter((f) => f.id.includes(filter) && !now.has(key(f)));
for (const f of fixed) console.log(`fixed ${key(f)}: remove it from glow-contrast-known.json`);
if (update) {
  const issue = known.findings[0]?.issue ?? null;
  known.findings = [...known.findings.filter((f) => !f.id.includes(filter)), ...found.map((f) => ({ ...f, issue: knownKeys.get(key(f))?.issue ?? issue }))]
    .sort((a, b) => key(a).localeCompare(key(b)));
  writeFileSync(knownPath, `${JSON.stringify(known, null, 2)}\n`);
  console.log(`wrote ${known.findings.length} known finding(s)`);
} else {
  console.log(`${found.length} shortfall(s), ${failures} not in glow-contrast-known.json, ${fixed.length} listed but fixed`);
  process.exit(failures || fixed.length ? 1 : 0);
}
