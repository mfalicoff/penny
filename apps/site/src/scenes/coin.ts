// A minted copper coin with Penny's leaf (the app icon) in relief. Splats carry normals, so the
// renderer lights them: the domed face, the bevel and the reeded rim catch the light as it turns.
//
// What keeps it from looking grainy: every face splat has the same colour (the lighting alone
// varies it), the splats along the leaf's outline are split into four smaller ones so the edge
// is crisp, and the dust is a few soft, faint motes rather than many bright points.
import { SplatBuilder, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, clamp, createRandom, gaussian, mixColor, shade } from "../splats/random.ts";
import { IDENTITY_FRAME, pushIn, r2, surfaceSigma, vogel, type Frame } from "./common.ts";
import { palette } from "./palette.ts";

const RADIUS = 1;
const THICKNESS = 0.13;
const BEVEL = 0.045;
const LIP = 0.9;
const RELIEF = 0.02;
/** How domed the faces are: the slope of the normal at the edge. */
const DOME = 0.14;
/** Ridges around the rim. Few enough that each gets several splats, so the rim doesn't alias. */
const REEDS = 120;

const BASE: Vec3 = [-0.3, -0.29, 0];
const TIP: Vec3 = [0.5, 0.52, 0];
const AXIS_LENGTH = Math.hypot(TIP[0] - BASE[0], TIP[1] - BASE[1]);
const AXIS = [(TIP[0] - BASE[0]) / AXIS_LENGTH, (TIP[1] - BASE[1]) / AXIS_LENGTH] as const;

export type LeafPart = "none" | "leaf" | "edge";

export interface LeafSample {
  part: LeafPart;
  /** Across the leaf, −1 at one edge to 1 at the other (0 on the stem). */
  across: number;
}

/** Where (x, y) on the coin face falls on the embossed leaf. */
export function leafSample(x: number, y: number): LeafSample {
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
        if (Math.abs(v - veinCentre) < veinWidth) return { part: "none", across: 0 };
      }
      return { part: Math.abs(off) > width - 0.016 ? "edge" : "leaf", across: off / Math.max(width, 1e-6) };
    }
  }
  const STEM_END = -0.24;
  const STEM_HALF = 0.028;
  if (u < 0.04 && u > STEM_END - STEM_HALF) {
    const centre = -0.25 * Math.max(u, STEM_END) ** 2;
    if (u >= STEM_END ? Math.abs(v - centre) < STEM_HALF : Math.hypot(u - STEM_END, v - centre) < STEM_HALF) {
      return { part: "leaf", across: 0 };
    }
  }
  return { part: "none", across: 0 };
}

export function leafAt(x: number, y: number): LeafPart {
  return leafSample(x, y).part;
}

const inLeaf = (x: number, y: number) => (leafAt(x, y) === "none" ? 0 : 1);

/** Whether a splat of `sigma` at (x, y) straddles the leaf's outline. */
function straddles(x: number, y: number, sigma: number): boolean {
  const here = inLeaf(x, y);
  const d = sigma * 1.5;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (inLeaf(x + d * Math.cos(a), y + d * Math.sin(a)) !== here) return true;
  }
  return false;
}

export interface CoinOptions {
  readonly frame?: Frame;
  readonly color?: Vec3;
  /** Emboss the leaf on the front face. */
  readonly leaf?: boolean;
}

interface FacePoint {
  x: number;
  y: number;
  sigma: number;
}

/** Front-face sample points: an even spiral, with the ones on the leaf's outline split in four. */
function frontPoints(n: number, leaf: boolean): FacePoint[] {
  const inner = RADIUS - BEVEL;
  const sigma = surfaceSigma(Math.PI * inner * inner, n, 0.8);
  const spacing = sigma / 0.8;
  const points: FacePoint[] = [];
  for (let i = 0; i < n; i++) {
    const [unit, angle] = vogel(i, n);
    const x = inner * unit * Math.cos(angle);
    const y = inner * unit * Math.sin(angle);
    if (leaf && straddles(x, y, sigma)) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        points.push({ x: x + dx * spacing * 0.25, y: y + dy * spacing * 0.25, sigma: sigma * 0.5 });
      }
    } else {
      points.push({ x, y, sigma });
    }
  }
  return points;
}

/** Pushes exactly `count` splats forming a coin of radius 1 (times the frame's scale). */
export function pushCoin(builder: SplatBuilder, count: number, options: CoinOptions = {}): void {
  const frame = options.frame ?? IDENTITY_FRAME;
  const metal = options.color ?? palette.copperMetal;
  const inner = RADIUS - BEVEL;
  // The front gets its share before splitting edge splats; the rest share what's left.
  const front = frontPoints(Math.round(count * 0.4), options.leaf ?? false);
  const [back, bevel, rim] = apportion(count - front.length, [0.58, 0.18, 0.24]) as [number, number, number];

  const facePixel = (point: FacePoint, side: 1 | -1) => {
    const { x, y, sigma } = point;
    const r = Math.hypot(x, y);
    let z = THICKNESS / 2;
    // A gentle dome: the highlight sweeps across the face as the coin turns.
    let normal: Vec3 = [x * DOME, y * DOME, 1];
    let color: Vec3 = metal;
    let shading = 1;
    if (r > LIP) {
      z += 0.012;
      if (r < LIP + 0.014) normal = [-x * 2.2, -y * 2.2, 1];
    }
    const sample = options.leaf && side > 0 ? leafSample(x, y) : { part: "none" as const, across: 0 };
    if (sample.part !== "none") {
      z += RELIEF;
      // Enamel rather than paint: lit, and domed across the leaf so it reads as relief.
      color = mixColor(palette.cream, metal, 0.06);
      shading = 0.8;
      const tilt = sample.across * 0.32;
      normal = [-AXIS[1] * tilt, AXIS[0] * tilt, 1];
      if (sample.part === "edge") {
        // The relief's walls: tilt the normal away from the leaf so its outline glints.
        const d = 0.01;
        const gx = inLeaf(x + d, y) - inLeaf(x - d, y);
        const gy = inLeaf(x, y + d) - inLeaf(x, y - d);
        const g = Math.hypot(gx, gy) || 1;
        normal = [(-gx / g) * 0.9, (-gy / g) * 0.9, 1];
        z -= RELIEF * 0.4;
      }
    }
    const t = Math.atan2(y, x);
    pushIn(builder, frame, {
      position: [x, y, z * side],
      scale: [sigma, sigma, 0.0012],
      normal: [normal[0], normal[1], normal[2] * side],
      tangent: [-Math.sin(t), Math.cos(t), 0],
      color,
      opacity: 1,
      shading,
    });
  };
  for (const point of front) facePixel(point, 1);
  const backSigma = surfaceSigma(Math.PI * inner * inner, back, 0.8);
  for (let i = 0; i < back; i++) {
    const [unit, angle] = vogel(i, back);
    facePixel({ x: inner * unit * Math.cos(angle + 0.5), y: inner * unit * Math.sin(angle + 0.5), sigma: backSigma }, -1);
  }

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
    const ripple = 0.4 * Math.sin(t * REEDS);
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

/** Soft dust around the coin: out of focus, faint and few, so it reads as atmosphere. */
function pushDust(builder: SplatBuilder, count: number, random: () => number): void {
  const colors = [palette.glow1, palette.glow2, palette.copperDark, palette.cream];
  for (let i = 0; i < count; i++) {
    const t = random() * Math.PI * 2;
    const r = RADIUS * (1.15 + 0.85 * random() ** 0.8);
    const s = 0.012 + 0.03 * random() ** 2;
    builder.push({
      position: [r * Math.cos(t), r * Math.sin(t) * 0.9, gaussian(random) * 0.5],
      scale: [s, s, s],
      color: colors[Math.floor(random() * colors.length)]!,
      opacity: 0.08 + 0.22 * random() ** 2,
      drift: 0.02,
    });
  }
}

/** A faint copper glow behind the coin. */
function pushGlow(builder: SplatBuilder, count: number, random: () => number): void {
  for (let i = 0; i < count; i++) {
    const t = random() * Math.PI * 2;
    const r = RADIUS * 0.9 * Math.sqrt(random());
    const s = 0.35 + 0.25 * random();
    builder.push({
      position: [r * Math.cos(t), r * Math.sin(t), -0.3 - 0.2 * random()],
      scale: [s, s, s * 0.4],
      color: mixColor(palette.glow1, palette.copperDark, random()),
      opacity: 0.025 + 0.02 * random(),
    });
  }
}

export function coinScene(count: number, seed = 11): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const dust = clamp(Math.round(count * 0.004), 40, 260);
  const glow = 48;
  pushCoin(builder, count - dust - glow, { leaf: true });
  pushGlow(builder, glow, random);
  pushDust(builder, dust, random);
  return builder.build();
}
