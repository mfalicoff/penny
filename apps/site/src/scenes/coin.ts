// A minted copper coin with Penny's leaf (the app icon) in relief. Splats carry normals, so the
// renderer lights them: the domed face, the bevel and the reeded rim catch the light as it turns.
import { SplatBuilder, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, clamp, createRandom, shade } from "../splats/random.ts";
import { halo, IDENTITY_FRAME, pushIn, r2, surfaceSigma, vogel, type Frame } from "./common.ts";
import { palette } from "./palette.ts";

const RADIUS = 1;
const THICKNESS = 0.13;
const BEVEL = 0.045;
const LIP = 0.9;
const RELIEF = 0.02;
/** How domed the faces are: the slope of the normal at the edge. */
const DOME = 0.14;

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
      return Math.abs(off) > width - 0.016 ? "edge" : "leaf";
    }
  }
  const STEM_END = -0.24;
  const STEM_HALF = 0.028;
  if (u < 0.04 && u > STEM_END - STEM_HALF) {
    const centre = -0.25 * Math.max(u, STEM_END) ** 2;
    if (u >= STEM_END ? Math.abs(v - centre) < STEM_HALF : Math.hypot(u - STEM_END, v - centre) < STEM_HALF) {
      return "leaf";
    }
  }
  return "none";
}

const inLeaf = (x: number, y: number) => (leafAt(x, y) === "none" ? 0 : 1);

export interface CoinOptions {
  readonly frame?: Frame;
  readonly color?: Vec3;
  /** Emboss the leaf on the front face. */
  readonly leaf?: boolean;
  readonly seed?: number;
}

/** Pushes exactly `count` splats forming a coin of radius 1 (times the frame's scale). */
export function pushCoin(builder: SplatBuilder, count: number, options: CoinOptions = {}): void {
  const frame = options.frame ?? IDENTITY_FRAME;
  const metal = options.color ?? palette.copperMetal;
  const random = createRandom(options.seed ?? 1);
  const inner = RADIUS - BEVEL;
  const [front, back, bevel, rim] = apportion(count, [0.42, 0.36, 0.1, 0.12]) as [number, number, number, number];

  const face = (n: number, side: 1 | -1) => {
    const sigma = surfaceSigma(Math.PI * inner * inner, n, 0.78);
    for (let i = 0; i < n; i++) {
      const [unit, angle] = vogel(i, n);
      const r = inner * unit;
      const t = angle + (side < 0 ? 0.5 : 0);
      const x = r * Math.cos(t), y = r * Math.sin(t);
      let z = THICKNESS / 2;
      // A gentle dome: the highlight sweeps across the face as the coin turns.
      let normal: Vec3 = [x * DOME, y * DOME, 1];
      let color: Vec3 = shade(metal, 0.96 + 0.08 * random());
      let shading = 1;
      if (r > LIP) {
        z += 0.012;
        if (r < LIP + 0.014) normal = [-x * 2.2, -y * 2.2, 1];
      }
      const part = options.leaf && side > 0 ? leafAt(x, y) : "none";
      if (part !== "none") {
        z += RELIEF;
        color = palette.cream;
        shading = 0.55;
        if (part === "edge") {
          // The relief's walls: tilt the normal away from the leaf so its outline glints.
          const d = 0.01;
          const gx = inLeaf(x + d, y) - inLeaf(x - d, y);
          const gy = inLeaf(x, y + d) - inLeaf(x, y - d);
          const g = Math.hypot(gx, gy) || 1;
          normal = [(-gx / g) * 0.9, (-gy / g) * 0.9, 1];
          z -= RELIEF * 0.4;
        }
      }
      pushIn(builder, frame, {
        position: [x, y, z * side],
        scale: [sigma, sigma, 0.0012],
        normal: [normal[0], normal[1], normal[2] * side],
        tangent: [-Math.sin(t), Math.cos(t), 0],
        color,
        opacity: 1,
        shading,
      });
    }
  };
  face(front, 1);
  face(back, -1);

  // The bevel: a quarter round from each face to the rim.
  const bevelSigma = surfaceSigma(2 * Math.PI * RADIUS * BEVEL * Math.PI, bevel, 0.8);
  for (let i = 0; i < bevel; i++) {
    const [a, b] = r2(i);
    const side = i % 2 ? 1 : -1;
    const t = a * Math.PI * 2;
    const phi = b * (Math.PI / 2);
    const r = inner + BEVEL * Math.sin(phi);
    const z = (THICKNESS / 2 - BEVEL * (1 - Math.cos(phi))) * side;
    pushIn(builder, frame, {
      position: [r * Math.cos(t), r * Math.sin(t), z],
      scale: [bevelSigma, bevelSigma, 0.0012],
      normal: [Math.cos(t) * Math.sin(phi), Math.sin(t) * Math.sin(phi), Math.cos(phi) * side],
      tangent: [-Math.sin(t), Math.cos(t), 0],
      color: shade(metal, 1.05),
      opacity: 1,
      shading: 1,
    });
  }

  // The rim, reeded: the normals ripple around it, so fine ridges glint as it turns.
  const height = THICKNESS - 2 * BEVEL + 0.02;
  const rimSigma = surfaceSigma(2 * Math.PI * RADIUS * height, rim, 0.8);
  for (let i = 0; i < rim; i++) {
    const [a, b] = r2(i);
    const t = a * Math.PI * 2;
    const ripple = 0.45 * Math.sin(t * 160);
    pushIn(builder, frame, {
      position: [RADIUS * Math.cos(t), RADIUS * Math.sin(t), (b - 0.5) * height],
      scale: [rimSigma * 0.7, rimSigma * 1.3, 0.0012],
      normal: [Math.cos(t + ripple * 0.5), Math.sin(t + ripple * 0.5), 0],
      tangent: [-Math.sin(t), Math.cos(t), 0],
      color: shade(metal, 0.9),
      opacity: 1,
      shading: 1,
    });
  }
}

export function coinScene(count: number, seed = 11): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const [coinCount, haloCount] = apportion(count, [0.99, 0.01]) as [number, number];
  pushCoin(builder, coinCount, { leaf: true, seed });
  halo(
    builder,
    haloCount,
    random,
    () => {
      const t = random() * Math.PI * 2;
      const r = RADIUS * (1.05 + 0.5 * random());
      return [r * Math.cos(t), r * Math.sin(t), (random() - 0.5) * 0.4];
    },
    [palette.glow1, palette.glow2, palette.copperDark],
    { spread: 0.08, size: [0.004, 0.012], opacity: [0.3, 0.8] },
  );
  return builder.build();
}
