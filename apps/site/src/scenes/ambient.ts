// Backdrop scenes that sit behind the app screenshots: they frame the real UI instead of
// imitating it.
import { normalize, SplatBuilder, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, createRandom, gaussian, lerp, mixColor, shade } from "../splats/random.ts";
import { frameAlong, halo, pushIn, r2, surfaceSigma, type Frame } from "./common.ts";
import { pushCoin } from "./coin.ts";
import { palette } from "./palette.ts";

/**
 * Your month at a glance: three orbits in the overview's colours (came in, invested, spent),
 * each brightening towards its head like a comet, with small coins riding them.
 */
export function ringsScene(count: number, seed = 61): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const rings = [
    { radius: 1.3, axis: [0.25, 1, 0.35] as Vec3, color: palette.income, roll: 0.3 },
    { radius: 1.12, axis: [-0.45, 1, -0.2] as Vec3, color: palette.invest, roll: 2.1 },
    { radius: 1.42, axis: [0.1, 1, -0.55] as Vec3, color: palette.copperDark, roll: 4.2 },
  ];
  const coins = 7;
  const [ringCount, coinCount, haloCount] = apportion(count, [0.62, 0.3, 0.08]) as [number, number, number];
  const perRing = apportion(ringCount, rings.map((r) => r.radius));
  rings.forEach((ring, k) => {
    const frame = frameAlong([0, 0, 0], ring.axis, 1, ring.roll);
    for (let i = 0; i < perRing[k]!; i++) {
      const [a] = r2(i);
      const t = a * Math.PI * 2;
      const head = a ** 2.2;
      const spread = 0.004 + 0.012 * (1 - head);
      const s = 0.003 + 0.005 * random() * (0.4 + head);
      pushIn(builder, frame, {
        position: [ring.radius * Math.cos(t) + gaussian(random) * spread, ring.radius * Math.sin(t) + gaussian(random) * spread, gaussian(random) * spread],
        scale: [s, s, s],
        color: mixColor(ring.color, palette.label, 0.3 * head),
        opacity: 0.05 + 0.65 * head ** 1.5,
      });
    }
  });
  const perCoin = apportion(coinCount, Array.from({ length: coins }, () => 1));
  const metals = [palette.copperMetal, palette.goldMetal, palette.roseMetal];
  for (let c = 0; c < coins; c++) {
    const ring = rings[c % rings.length]!;
    const frame = frameAlong([0, 0, 0], ring.axis, 1, ring.roll);
    const t = 1.1 + c * 2.3;
    const local: Vec3 = [ring.radius * Math.cos(t), ring.radius * Math.sin(t), 0];
    const world: Vec3 = [
      frame.x[0] * local[0] + frame.y[0] * local[1],
      frame.x[1] * local[0] + frame.y[1] * local[1],
      frame.x[2] * local[0] + frame.y[2] * local[1],
    ];
    pushCoin(builder, perCoin[c]!, {
      frame: frameAlong(world, [0.3 * Math.sin(c * 1.7), 0.25 * Math.cos(c), 1], 0.11 + 0.03 * (c % 3), c),
      color: metals[c % metals.length]!,
      seed: seed + c,
    });
  }
  halo(builder, haloCount, random, () => {
    const t = random() * Math.PI * 2;
    return [1.25 * Math.cos(t), gaussian(random) * 0.3, 1.25 * Math.sin(t) * 0.5];
  }, [palette.glow1, palette.invest, palette.glow2], { spread: 0.2, size: [0.012, 0.04], opacity: [0.015, 0.05] });
  return builder.build();
}

/** Keep the receipt: paper receipts caught in a slow vortex. */
export function papersScene(count: number, seed = 71): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const sheets = 9;
  const [paperCount, haloCount] = apportion(count, [0.95, 0.05]) as [number, number];
  const perSheet = apportion(paperCount, Array.from({ length: sheets }, () => 1));
  const W = 0.34, H = 0.62;
  for (let k = 0; k < sheets; k++) {
    const angle = k * ((Math.PI * 2) / sheets) + 0.4;
    const radius = 0.95 + 0.35 * ((k * 7) % 3) / 2;
    const origin: Vec3 = [radius * Math.cos(angle), 0.55 * Math.sin(angle * 1.3) + (k % 2 ? 0.2 : -0.2), radius * Math.sin(angle) * 0.6];
    const frame = frameAlong(origin, [Math.sin(angle * 2.1) * 0.6, Math.cos(angle) * 0.35, 1], 0.85 + 0.3 * random(), angle * 0.7 - 0.5);
    const n = perSheet[k]!;
    const sigma = surfaceSigma(W * H, n, 0.8);
    const lines = 7;
    for (let placed = 0, j = 0; placed < n; j++) {
      const [u, v] = r2(j);
      const x = (u - 0.5) * W;
      const y = (v - 0.5) * H;
      // The torn edge at the bottom.
      const tooth = (((x / W + 0.5) * 18) % 1);
      if (y < -H / 2 + 0.018 * (1 - Math.abs(tooth * 2 - 1))) continue;
      placed++;
      const curl = 0.06 * Math.sin((y / H) * 3 + k);
      const normal = normalize([0, -0.06 * Math.cos((y / H) * 3 + k) * (3 / H), 1]);
      // Printed lines: soft grey bars, a copper total.
      const row = Math.floor(((H / 2 - y) / H) * (lines + 3));
      const inRow = (((H / 2 - y) / H) * (lines + 3)) % 1;
      let color: Vec3 = palette.cream;
      if (row >= 1 && row <= lines + 1 && inRow > 0.35 && inRow < 0.65) {
        const length = row === 1 ? 0.55 : 0.35 + 0.45 * ((row * 37) % 10) / 10;
        const total = row === lines + 1;
        if (x < -W / 2 + 0.05 + length * (W - 0.1) || (x > W / 2 - 0.05 - (total ? 0.11 : 0.07) && row > 1)) {
          color = total ? palette.copper : shade(palette.cream, 0.62);
        }
      }
      pushIn(builder, frame, {
        position: [x, y, curl],
        scale: [sigma, sigma, 0.001],
        normal,
        color,
        opacity: 1,
        shading: 0.6,
      });
    }
  }
  halo(builder, haloCount, random, () => {
    const t = random() * Math.PI * 2;
    const r = 0.6 + random();
    return [r * Math.cos(t), gaussian(random) * 0.5, r * Math.sin(t) * 0.6];
  }, [palette.glow2, palette.glow1, palette.cream], { spread: 0.1, size: [0.008, 0.03], opacity: [0.03, 0.12] });
  return builder.build();
}

/** Everywhere: a figure-eight loop between two devices, the sync between phone and browser. */
export function loopScene(count: number, seed = 81): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const [tubeCount, beadCount, coreCount, haloCount] = apportion(count, [0.7, 0.08, 0.14, 0.08]) as [number, number, number, number];
  const A = 1.45;
  const at = (t: number): Vec3 => {
    const d = 1 + Math.sin(t) ** 2;
    return [(A * Math.cos(t)) / d, (A * Math.sin(t) * Math.cos(t)) / d, 0.35 * Math.sin(t)];
  };
  const colorAt = (t: number) => {
    const u = (Math.cos(t) + 1) / 2;
    return mixColor(palette.invest, palette.copperDark, u);
  };
  for (let i = 0; i < tubeCount; i++) {
    const [a] = r2(i);
    const t = a * Math.PI * 2;
    const p = at(t);
    const r = 0.016 * Math.sqrt(random());
    const s = 0.0025 + 0.004 * random();
    builder.push({
      position: [p[0] + gaussian(random) * r, p[1] + gaussian(random) * r, p[2] + gaussian(random) * r],
      scale: [s, s, s],
      color: colorAt(t),
      opacity: 0.3 + 0.35 * random(),
    });
  }
  // Packets travelling the loop.
  for (let i = 0; i < beadCount; i++) {
    const packet = Math.floor(random() * 14);
    const t = packet * ((Math.PI * 2) / 14) + random() * 0.05;
    const p = at(t);
    const s = 0.01 + 0.01 * random();
    builder.push({
      position: [p[0] + gaussian(random) * 0.012, p[1] + gaussian(random) * 0.012, p[2] + gaussian(random) * 0.012],
      scale: [s, s, s],
      color: mixColor(colorAt(t), palette.label, 0.5),
      opacity: 0.9,
    });
  }
  // Two glowing cores: the devices the loop connects.
  for (let i = 0; i < coreCount; i++) {
    const side = i % 2 ? 1 : -1;
    const r = 0.1 * Math.cbrt(random());
    const dir = normalize([gaussian(random), gaussian(random), gaussian(random)]);
    const s = 0.004 + 0.01 * random();
    builder.push({
      position: [side * A * 0.62 + dir[0] * r, dir[1] * r, dir[2] * r],
      scale: [s, s, s],
      color: mixColor(side > 0 ? palette.copperDark : palette.invest, palette.label, 0.35 * (1 - r / 0.1)),
      opacity: 0.2 + 0.5 * (1 - r / 0.1),
    });
  }
  halo(builder, haloCount, random, () => at(random() * Math.PI * 2), [palette.glow1, palette.invest, palette.glow3], {
    spread: 0.12, size: [0.012, 0.04], opacity: [0.015, 0.05],
  });
  return builder.build();
}

/** Together: three coins in different metals, joined by the arcs of what they share. */
export function trioScene(count: number, seed = 91): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const [coinCount, arcCount, haloCount] = apportion(count, [0.84, 0.1, 0.06]) as [number, number, number];
  const perCoin = apportion(coinCount, [1, 1, 1]);
  const centres: Vec3[] = [0, 1, 2].map((k) => {
    const a = Math.PI / 2 + k * ((Math.PI * 2) / 3);
    return [1.05 * Math.cos(a), 0.85 * Math.sin(a) - 0.05, 0.25 * Math.sin(a * 2)];
  });
  const metals = [palette.copperMetal, palette.goldMetal, palette.roseMetal];
  centres.forEach((c, k) => {
    const frame: Frame = frameAlong(c, [0.35 * Math.cos(k * 2.1), 0.2 * Math.sin(k * 1.3), 1], 0.3, k * 0.9);
    pushCoin(builder, perCoin[k]!, { frame, color: metals[k]!, leaf: true, seed: seed + k });
  });
  for (let i = 0; i < arcCount; i++) {
    const k = i % 3;
    const a = centres[k]!, b = centres[(k + 1) % 3]!;
    const t = random();
    const lift = Math.sin(Math.PI * t);
    const mid: Vec3 = [(a[0] + b[0]) / 2 * 1.9, (a[1] + b[1]) / 2 * 1.9, 0.3];
    const p: Vec3 = [
      lerp(lerp(a[0], mid[0], t), lerp(mid[0], b[0], t), t),
      lerp(lerp(a[1], mid[1], t), lerp(mid[1], b[1], t), t),
      lerp(lerp(a[2], mid[2], t), lerp(mid[2], b[2], t), t),
    ];
    const s = 0.004 + 0.006 * random();
    builder.push({
      position: [p[0] + gaussian(random) * 0.01, p[1] + gaussian(random) * 0.01, p[2] + gaussian(random) * 0.01],
      scale: [s, s, s],
      color: mixColor(metals[k]!, palette.glow2, 0.6),
      opacity: 0.25 + 0.6 * lift,
    });
  }
  halo(builder, haloCount, random, () => centres[Math.floor(random() * 3)]!, [palette.glow1, palette.glow2, palette.glow3], {
    spread: 0.3, size: [0.003, 0.01], opacity: [0.2, 0.6],
  });
  return builder.build();
}
