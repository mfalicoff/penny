// The money-flow ribbons behind the showcase: income streaming from the left into categories,
// investments and what's left over, as glowing bands in depth.
//
// Each band is a regular grid of round, overlapping splats at one depth (overlapping Gaussians on
// a grid sum to an even surface), with colour and opacity varying smoothly and no per-splat
// randomness: bands read as smooth light rather than noise or brush strokes. Opacity falls off
// softly over a band's outer rows, which keeps its outline clean.
import { SplatBuilder, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, lerp, mixColor, smoothstep } from "../splats/random.ts";
import { palette } from "./palette.ts";

/** Half the scene's width and height, in world units: the camera fits the width. */
export const FLOW_HALF_WIDTH = 2.4;
export const FLOW_HALF_HEIGHT = 1.25;

interface Band {
  readonly to: Vec3;
  /** Share of the income. */
  readonly amount: number;
  /** Where the band ends on the right, from −1 (bottom) to 1 (top). */
  readonly end: number;
}

/** The same shape as the demo's money flow: home, groceries, food, invested, left over. */
const BANDS: readonly Band[] = [
  { to: palette.home, amount: 0.3, end: 0.7 },
  { to: palette.groceries, amount: 0.09, end: 0.32 },
  { to: palette.food, amount: 0.06, end: 0.02 },
  { to: palette.invest, amount: 0.08, end: -0.26 },
  { to: palette.copperDark, amount: 0.37, end: -0.66 },
];

/** Total height of the bands where they leave the source, in world units. */
const SOURCE_HEIGHT = 0.5;

interface Laid extends Band {
  index: number;
  /** Top and bottom at the source. */
  s0: number;
  s1: number;
  /** Height in world units. */
  h: number;
}

function layBands(): Laid[] {
  const total = BANDS.reduce((sum, band) => sum + band.amount, 0);
  let y = SOURCE_HEIGHT / 2;
  return BANDS.map((band, index) => {
    const h = (band.amount / total) * SOURCE_HEIGHT;
    const laid = { ...band, index, s0: y, s1: y - h, h };
    y -= h;
    return laid;
  });
}

/** Centre line of a band at u ∈ [0, 1], left to right: flat at both ends, an S in between. */
export function bandCentre(band: { s0: number; s1: number; end: number }, u: number): number {
  const start = (band.s0 + band.s1) / 2;
  const end = band.end * FLOW_HALF_HEIGHT * 0.88;
  return lerp(start, end, smoothstep(0.18, 0.82, u));
}

export function flowScene(count: number): SplatCloud {
  const builder = new SplatBuilder(count);
  const bands = layBands();
  const left = -FLOW_HALF_WIDTH;
  const width = FLOW_HALF_WIDTH * 2;
  const depth = (band: Laid) => (band.index - (bands.length - 1) / 2) * -0.09;
  const colorAt = (band: Laid, u: number) => mixColor(palette.income, band.to, smoothstep(0.2, 0.8, u));

  const [bandCount, bloomCount] = apportion(count, [0.96, 0.04]) as [number, number];
  const perBand = apportion(bandCount, bands.map((band) => band.h));

  bands.forEach((band, i) => {
    const n = perBand[i]!;
    // A grid as square as the band allows: columns along it, rows across it.
    const columns = Math.min(n, Math.max(2, Math.round(Math.sqrt((n * width) / band.h))));
    const rows = Math.max(1, Math.floor(n / columns));
    const spacing = width / columns;
    // Drawn additively (src/splats/stage.ts): about ten splats overlap at any point, and their
    // light sums to an even band.
    const sigma = spacing * 1.25;
    const emit = (u: number, across: number, weight: number) => {
      const y = bandCentre(band, u) + (across - 0.5) * band.h;
      // Soft outer rows, and a fade where the band leaves the source and where it leaves the frame.
      const edge = smoothstep(0, 0.22, across) * smoothstep(1, 0.78, across);
      const ends = smoothstep(0, 0.22, u) * smoothstep(1, 0.9, u);
      // Light from above: the top of each band is a little brighter, smoothly.
      const lift = 0.9 + 0.2 * across;
      const color = colorAt(band, u);
      builder.push({
        position: [left + width * u, y, depth(band)],
        scale: [sigma, sigma, 0.002],
        color: [Math.min(1, color[0] * lift), Math.min(1, color[1] * lift), Math.min(1, color[2] * lift)],
        opacity: 0.065 * edge * ends * weight,
      });
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) emit((c + 0.5) / columns, (r + 0.5) / rows, 1);
    }
    // Whatever the grid leaves of the budget runs along the centre line, faintly.
    const rest = n - rows * columns;
    for (let k = 0; k < rest; k++) emit((k + 0.5) / rest, 0.5, 0.3);
  });

  // Bloom: large, faint splats along each band's centre line, so the bands glow.
  const perBloom = apportion(bloomCount, bands.map((band) => band.h + 0.05));
  bands.forEach((band, i) => {
    const n = perBloom[i]!;
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const s = Math.max(0.06, band.h * 0.8);
      builder.push({
        position: [left + width * u, bandCentre(band, u), depth(band) - 0.05],
        scale: [s * 1.4, s, s * 0.3],
        color: colorAt(band, u),
        opacity: 0.025 * smoothstep(0, 0.25, u) * smoothstep(1, 0.9, u),
      });
    }
  });

  return builder.build();
}
