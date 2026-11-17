// A copper coin with Penny's leaf (the app icon) embossed on its face.
import { SplatBuilder, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, clamp, createRandom, mixColor, shade } from "../splats/random.ts";
import { halo, r2, surfaceSigma, vogel } from "./common.ts";
import { palette } from "./palette.ts";

const RADIUS = 1;
const THICKNESS = 0.14;
const LIP = 0.9;
const RELIEF = 0.022;

const BASE: Vec3 = [-0.3, -0.29, 0];
const TIP: Vec3 = [0.5, 0.52, 0];
const AXIS_LENGTH = Math.hypot(TIP[0] - BASE[0], TIP[1] - BASE[1]);
const AXIS = [(TIP[0] - BASE[0]) / AXIS_LENGTH, (TIP[1] - BASE[1]) / AXIS_LENGTH] as const;

export type LeafPart = "none" | "leaf" | "edge";

/** Where (x, y) on the coin face falls on the embossed leaf. */
export function leafAt(x: number, y: number): LeafPart {
  const px = (x - BASE[0]) / AXIS_LENGTH;
  const py = (y - BASE[1]) / AXIS_LENGTH;
  const u = px * AXIS[0] + py * AXIS[1];
  const v = -px * AXIS[1] + py * AXIS[0];
  const bend = 0.05 * Math.sin(Math.PI * clamp(u, 0, 1));

  if (u >= 0 && u <= 1) {
    const width = 0.3 * Math.sqrt(Math.sin(Math.PI * u ** 0.9)) * (1 - 0.32 * u);
    const off = v - bend;
    if (Math.abs(off) < width) {
      // The vein: a thin crescent that shows the copper underneath.
      const vu = (u - 0.14) / 0.6;
      if (vu > 0 && vu < 1) {
        const veinCentre = bend - 0.035 - 0.07 * Math.sin(Math.PI * vu);
        const veinWidth = 0.024 * Math.sin(Math.PI * vu) ** 0.7;
        if (Math.abs(v - veinCentre) < veinWidth) return "none";
      }
      return Math.abs(off) > width - 0.012 ? "edge" : "leaf";
    }
  }
  // The stem, curving slightly to the lower left.
  const STEM_END = -0.24;
  const STEM_HALF = 0.028;
  if (u < 0.04 && u > STEM_END - STEM_HALF) {
    const centre = -0.25 * Math.max(u, STEM_END) ** 2;
    // Straight sides, rounded end.
    if (u >= STEM_END ? Math.abs(v - centre) < STEM_HALF : Math.hypot(u - STEM_END, v - centre) < STEM_HALF) {
      return "leaf";
    }
  }
  return "none";
}

function faceColor(x: number, y: number, back: boolean): [number, number, number] {
  const r = Math.hypot(x, y);
  const theta = Math.atan2(y, x);
  // Baked light from the upper left, lathe rings and a soft anisotropic highlight.
  const light = 0.8 + 0.2 * (-0.55 * x + 0.75 * y) * (back ? -1 : 1);
  const rings = 0.04 * Math.sin(r * 260) + 0.025 * Math.sin(r * 71 + 1.3);
  const sheen = 0.28 * Math.exp(-((Math.cos(theta - 2.3) - 1) ** 2) / 0.02) * r;
  let k = light + rings + sheen;
  if (r > LIP) k += 0.12;
  if (back) {
    // Concentric grooves on the reverse.
    for (const groove of [0.32, 0.55, 0.74]) k -= 0.25 * Math.exp(-(((r - groove) / 0.012) ** 2));
  }
  return shade(palette.copperIcon, k);
}

export function coinScene(count: number, seed = 11): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const [frontCount, backCount, rimCount, haloCount] = apportion(count, [0.46, 0.38, 0.13, 0.03]) as [number, number, number, number];

  const face = (n: number, back: boolean) => {
    const sigma = surfaceSigma(Math.PI * RADIUS * RADIUS, n, 0.75);
    const sign = back ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const [unit, angle] = vogel(i, n);
      const r = RADIUS * unit;
      const t = angle + (back ? 0.5 : 0);
      const x = r * Math.cos(t);
      const y = r * Math.sin(t);
      let z = THICKNESS / 2;
      let color = faceColor(x, y, back);
      if (r > LIP) z += 0.016;
      if (!back) {
        const part = leafAt(x, y);
        if (part !== "none") {
          z += RELIEF;
          const lit = 0.9 + 0.12 * (-0.55 * x + 0.75 * y);
          color = part === "edge" ? shade(mixColor(palette.cream, palette.copperIcon, 0.35), lit * 0.85) : shade(palette.cream, lit);
        }
      }
      builder.push({
        position: [x, y, z * sign],
        // Slightly stretched along the lathe direction for a brushed look.
        scale: [sigma * 1.25, sigma * 0.85, 0.0015],
        normal: [0, 0, sign],
        tangent: [-Math.sin(t), Math.cos(t), 0],
        color,
        opacity: 1,
      });
    }
  };
  face(frontCount, false);
  face(backCount, true);

  const rimSigma = surfaceSigma(2 * Math.PI * RADIUS * (THICKNESS + 0.032), rimCount);
  for (let i = 0; i < rimCount; i++) {
    const [a, b] = r2(i);
    const t = a * Math.PI * 2;
    const z = (b - 0.5) * (THICKNESS + 0.032);
    const reed = 0.82 + 0.22 * Math.sign(Math.sin(t * 140)) * 0.5 + 0.18 * Math.cos(t - 2.3);
    builder.push({
      position: [RADIUS * Math.cos(t), RADIUS * Math.sin(t), z],
      scale: [rimSigma * 0.7, rimSigma * 1.4, 0.0015],
      normal: [Math.cos(t), Math.sin(t), 0],
      tangent: [-Math.sin(t), Math.cos(t), 0],
      color: shade(palette.copperIcon, reed),
      opacity: 1,
    });
  }

  halo(
    builder,
    haloCount,
    random,
    () => {
      const t = random() * Math.PI * 2;
      const r = RADIUS * (0.85 + 0.35 * random());
      return [r * Math.cos(t), r * Math.sin(t), (random() - 0.5) * 0.3];
    },
    [palette.glow1, palette.glow2, palette.copperDark, palette.glow3],
    { spread: 0.06, size: [0.015, 0.05], opacity: [0.015, 0.05] },
  );

  return builder.build();
}
