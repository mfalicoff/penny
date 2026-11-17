// A curled paper receipt for the README's 74.40 dinner, split three ways.
import { SplatBuilder, normalize, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, createRandom, gaussian, shade } from "../splats/random.ts";
import { halo, r2, surfaceSigma } from "./common.ts";
import { ADVANCE, GLYPH_HEIGHT, rasterize } from "./font.ts";
import { palette } from "./palette.ts";

const HALF_WIDTH = 0.46;
const TOP = 0.95;
const BOTTOM = -0.95;
const COLUMNS = 22;
const PX = 0.8 / (COLUMNS * ADVANCE);
const LINE = PX * 10;

/** Fixed-width row with `left` and `right` pushed to the edges. */
export function row(left: string, right = "", width = COLUMNS): string {
  const gap = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(gap) + right;
}

export const ITEMS: readonly [string, number][] = [
  ["2 PASTA", 36],
  ["SALAD", 12.5],
  ["BREAD", 4.9],
  ["SPARKLING", 6.5],
  ["TIRAMISU", 9.5],
  ["ESPRESSO X2", 5],
];
export const TOTAL = ITEMS.reduce((sum, [, amount]) => sum + amount, 0);
export const SHARE = TOTAL / 3;

interface TextRun {
  readonly text: string;
  /** Left edge, or the centre when `centre` is set. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  readonly px: number;
  readonly color: Vec3;
  readonly centre?: boolean;
  readonly angle?: number;
}

function receiptText(): TextRun[] {
  const left = -0.4;
  const runs: TextRun[] = [];
  let y = 0.84;
  runs.push({ text: "CORNER BISTRO", x: 0, y, px: PX * 1.55, color: palette.ink, centre: true });
  y -= PX * 1.55 * GLYPH_HEIGHT + LINE * 0.6;
  runs.push({ text: row("TABLE 4", "12 NOV 2026"), x: left, y, px: PX, color: palette.label2 });
  y -= LINE;
  runs.push({ text: "-".repeat(COLUMNS), x: left, y, px: PX, color: palette.label2 });
  y -= LINE;
  for (const [name, amount] of ITEMS) {
    runs.push({ text: row(name, amount.toFixed(2)), x: left, y, px: PX, color: palette.ink });
    y -= LINE;
  }
  runs.push({ text: "-".repeat(COLUMNS), x: left, y, px: PX, color: palette.label2 });
  y -= LINE;
  runs.push({ text: row("TOTAL", TOTAL.toFixed(2), 19), x: left, y, px: PX * 1.15, color: palette.ink });
  y -= LINE * 1.25;
  runs.push({ text: row("SPLIT 3 WAYS", "EQUAL"), x: left, y, px: PX, color: palette.label2 });
  y -= LINE;
  runs.push({ text: row("YOUR SHARE", SHARE.toFixed(2)), x: left, y, px: PX, color: palette.copper });
  y -= LINE * 1.6;
  runs.push({ text: "THANK YOU", x: 0, y, px: PX, color: palette.label2, centre: true });
  runs.push({ text: "PAID", x: 0.2, y: -0.33, px: PX * 1.7, color: palette.copper, centre: true, angle: -0.3 });
  return runs;
}

/** Paper surface height and normal: a gentle curl along its length and across. */
function surface(x: number, y: number): { z: number; normal: Vec3 } {
  const z = 0.09 * Math.sin(1.5 * y + 0.5) + 0.14 * x * x;
  const dzdx = 0.28 * x;
  const dzdy = 0.135 * Math.cos(1.5 * y + 0.5);
  return { z, normal: normalize([-dzdx, -dzdy, 1]) };
}

function bottomEdge(x: number): number {
  const t = (x * 22) % 2;
  return BOTTOM + 0.03 * (1 - Math.abs((t < 0 ? t + 2 : t) - 1));
}

const BARCODE = (() => {
  const random = createRandom(7);
  const bars: [number, number][] = [];
  let x = -0.3;
  while (x < 0.3) {
    const w = 0.004 + 0.012 * random();
    bars.push([x, x + w]);
    x += w + 0.004 + 0.01 * random();
  }
  return bars;
})();

function paperColor(x: number, y: number): { color: Vec3; ink: boolean } {
  // The PAID stamp's ring.
  const sr = Math.hypot(x - 0.2, y + 0.36);
  if (sr > 0.115 && sr < 0.135) return { color: palette.copper, ink: true };
  if (y > -0.78 && y < -0.62 && BARCODE.some(([a, b]) => x >= a && x <= b)) return { color: palette.ink, ink: true };
  return { color: palette.cream, ink: false };
}

const LIGHT = normalize([-0.4, 0.55, 0.75]);

export function receiptScene(count: number, seed = 37): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const runs = receiptText();
  const [paperCount, textCount, haloCount] = apportion(count, [0.68, 0.29, 0.03]) as [number, number, number];

  const area = HALF_WIDTH * 2 * (TOP - BOTTOM);
  const sigma = surfaceSigma(area, paperCount);
  for (let i = 0, k = 0; i < paperCount; k++) {
    const [u, v] = r2(k);
    const x = (u * 2 - 1) * HALF_WIDTH;
    const y = BOTTOM + v * (TOP - BOTTOM);
    if (y < bottomEdge(x)) continue;
    i++;
    const { z, normal } = surface(x, y);
    const lit = 0.72 + 0.32 * Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
    const { color, ink } = paperColor(x, y);
    builder.push({
      position: [x, y, z],
      scale: [sigma, sigma, 0.0012],
      normal,
      color: ink ? color : shade(color, lit * (0.97 + 0.04 * random())),
      opacity: 0.97,
    });
  }

  // Text: several small splats per lit font pixel, just above the paper.
  const pixels: { x: number; y: number; px: number; color: Vec3 }[] = [];
  for (const run of runs) {
    const lit = rasterize(run.text);
    const width = run.text.length * ADVANCE * run.px;
    const x0 = run.centre ? -width / 2 : 0;
    const cos = Math.cos(run.angle ?? 0), sin = Math.sin(run.angle ?? 0);
    const cy = run.centre ? (GLYPH_HEIGHT * run.px) / 2 : 0;
    for (const [col, line] of lit) {
      const lx = x0 + (col + 0.5) * run.px;
      const ly = -(line + 0.5) * run.px + cy;
      pixels.push({
        x: run.x + lx * cos - ly * sin,
        y: run.y - cy + lx * sin + ly * cos,
        px: run.px,
        color: run.color,
      });
    }
  }
  const perPixel = apportion(textCount, pixels.map(() => 1));
  pixels.forEach((p, i) => {
    for (let k = 0; k < perPixel[i]!; k++) {
      const x = p.x + (random() - 0.5) * p.px * 0.9;
      const y = p.y + (random() - 0.5) * p.px * 0.9;
      const { z, normal } = surface(x, y);
      const s = p.px * 0.38;
      builder.push({
        position: [x + normal[0] * 0.002, y + normal[1] * 0.002, z + normal[2] * 0.002],
        scale: [s, s, 0.001],
        normal,
        color: p.color,
        opacity: 0.9,
      });
    }
  });

  halo(
    builder,
    haloCount,
    random,
    () => {
      const x = gaussian(random) * 0.35;
      const y = gaussian(random) * 0.7;
      return [x, y, surface(x, y).z - 0.05];
    },
    [palette.glow2, palette.glow1, palette.cream],
    { spread: 0.08, size: [0.015, 0.045], opacity: [0.012, 0.04] },
  );

  return builder.build();
}
