// An iPhone and a browser window showing Penny, synced through a self-hosted server.
import { SplatBuilder, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, createRandom, lerp, shade } from "../splats/random.ts";
import { halo, inRoundedRect, paint, r2, surfaceSigma, type Rect } from "./common.ts";
import { palette } from "./palette.ts";

interface Panel {
  /** Centre of the panel. */
  readonly centre: Vec3;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** Rotation about y. */
  readonly yaw: number;
  /** Bezel width; the screen is inset by it. */
  readonly bezel: number;
  readonly bezelColor: Vec3;
  /** Screen contents in panel coordinates, (0, 0) at the centre. */
  readonly screen: readonly Rect[];
  readonly background: Vec3;
}

const bar = (x0: number, y0: number, w: number, h: number, color: Vec3, radius = Math.min(w, h) / 2): Rect => ({
  x0, y0, x1: x0 + w, y1: y0 + h, radius, color,
});

function phoneScreen(): Rect[] {
  const s = palette.surface;
  const rects: Rect[] = [
    // Hero card with the copper glow, the month's numbers as bars.
    { x0: -0.27, y0: 0.18, x1: 0.27, y1: 0.5, radius: 0.05, color: shade(palette.copper, 0.75) },
    bar(-0.23, 0.42, 0.18, 0.025, palette.cream),
    bar(-0.23, 0.33, 0.32, 0.05, palette.label),
    bar(-0.23, 0.25, 0.1, 0.03, palette.income),
    bar(-0.08, 0.25, 0.1, 0.03, palette.label2),
    bar(0.07, 0.25, 0.1, 0.03, palette.invest),
    // Calendar dots.
    { x0: -0.27, y0: -0.08, x1: 0.27, y1: 0.14, radius: 0.04, color: s },
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 7; c++) {
      const active = (r * 7 + c) % 4 === 1;
      rects.push(bar(-0.24 + c * 0.072, 0.07 - r * 0.06, 0.035, 0.035, active ? palette.copperDark : palette.surface2));
    }
  }
  // Entry rows.
  const rowColors = [palette.food, palette.groceries, palette.home, palette.transport];
  rowColors.forEach((color, i) => {
    const y = -0.17 - i * 0.085;
    rects.push({ x0: -0.27, y0: y - 0.035, x1: 0.27, y1: y + 0.035, radius: 0.025, color: s });
    rects.push(bar(-0.25, y - 0.022, 0.044, 0.044, color));
    rects.push(bar(-0.18, y - 0.008, 0.2, 0.018, palette.label2));
    rects.push(bar(0.12, y - 0.01, 0.12, 0.02, palette.label));
  });
  // Tab bar and the copper add button.
  rects.push({ x0: -0.27, y0: -0.58, x1: 0.15, y1: -0.5, radius: 0.04, color: palette.surface2 });
  rects.push(bar(0.18, -0.58, 0.08, 0.08, palette.copperDark));
  return rects;
}

function browserScreen(): Rect[] {
  const rects: Rect[] = [
    // Sidebar.
    { x0: -0.72, y0: -0.43, x1: -0.44, y1: 0.36, color: palette.surface },
    bar(-0.68, 0.27, 0.06, 0.06, palette.copperIcon),
    ...[0, 1, 2, 3, 4].map((i) => bar(-0.68, 0.16 - i * 0.07, 0.18, 0.02, i === 0 ? palette.copperText : palette.label2)),
    // Summary cards.
    ...[0, 1, 2, 3].map((i) => {
      const x0 = -0.4 + i * 0.28;
      return { x0, y0: 0.18, x1: x0 + 0.25, y1: 0.33, radius: 0.025, color: palette.surface };
    }),
    ...[palette.income, palette.label, palette.invest, palette.copperDark].map((color, i) =>
      bar(-0.38 + i * 0.28, 0.21, 0.15, 0.035, color)),
    // A money-flow chart.
    { x0: -0.4, y0: -0.4, x1: 0.69, y1: 0.13, radius: 0.025, color: palette.surface },
  ];
  const flows: [number, number, number, Vec3][] = [
    [0.02, 0.0, 0.07, palette.home],
    [-0.04, -0.11, 0.05, palette.groceries],
    [-0.09, -0.2, 0.04, palette.food],
    [-0.13, -0.29, 0.05, palette.invest],
  ];
  for (const [ys, yt, h, color] of flows) {
    for (let k = 0; k <= 40; k++) {
      const a = k / 40;
      const b = a * a * (3 - 2 * a);
      const x = lerp(-0.33, 0.6, a);
      const y = lerp(ys, yt, b);
      rects.push({ x0: x - 0.013, y0: y - h / 2, x1: x + 0.013, y1: y + h / 2, color: shade(color, 0.85) });
    }
  }
  rects.push(bar(-0.36, -0.2, 0.03, 0.26, palette.income, 0.01));
  return rects;
}

const PHONE: Panel = {
  centre: [-0.62, -0.02, 0.25],
  width: 0.64,
  height: 1.32,
  radius: 0.1,
  yaw: 0.22,
  bezel: 0.025,
  bezelColor: shade(palette.graphite, 1.6),
  screen: phoneScreen(),
  background: [0, 0, 0],
};

const BROWSER: Panel = {
  centre: [0.42, 0.18, -0.3],
  width: 1.5,
  height: 0.98,
  radius: 0.05,
  yaw: -0.18,
  bezel: 0.02,
  bezelColor: shade(palette.graphite, 1.4),
  screen: [
    // Title bar with traffic lights.
    { x0: -0.75, y0: 0.37, x1: 0.75, y1: 0.49, color: palette.surface2 },
    bar(-0.71, 0.415, 0.03, 0.03, palette.danger),
    bar(-0.66, 0.415, 0.03, 0.03, palette.pending),
    bar(-0.61, 0.415, 0.03, 0.03, palette.income),
    { x0: -0.4, y0: 0.405, x1: 0.4, y1: 0.455, radius: 0.025, color: palette.surface },
    ...browserScreen(),
  ],
  background: [0.02, 0.02, 0.02],
};

function placeOnPanel(panel: Panel, u: number, v: number, lift = 0): Vec3 {
  const c = Math.cos(panel.yaw), s = Math.sin(panel.yaw);
  return [panel.centre[0] + u * c + lift * s, panel.centre[1] + v, panel.centre[2] - u * s + lift * c];
}

function panelSplats(builder: SplatBuilder, panel: Panel, n: number): void {
  const area = panel.width * panel.height;
  const sigma = surfaceSigma(area, n);
  const outer: Rect = {
    x0: -panel.width / 2, y0: -panel.height / 2, x1: panel.width / 2, y1: panel.height / 2,
    radius: panel.radius, color: panel.bezelColor,
  };
  const inner: Rect = {
    x0: outer.x0 + panel.bezel, y0: outer.y0 + panel.bezel, x1: outer.x1 - panel.bezel, y1: outer.y1 - panel.bezel,
    radius: Math.max(0, panel.radius - panel.bezel), color: panel.background,
  };
  const normal: Vec3 = [Math.sin(panel.yaw), 0, Math.cos(panel.yaw)];
  let placed = 0;
  for (let j = 0; placed < n; j++) {
    const [ru, rv] = r2(j);
    const u = (ru - 0.5) * panel.width;
    const v = (rv - 0.5) * panel.height;
    if (!inRoundedRect(u, v, outer)) continue;
    const onScreen = inRoundedRect(u, v, inner);
    const color = onScreen ? paint(u, v, panel.screen, panel.background) : panel.bezelColor;
    // Screens glow a little brighter towards the top.
    const k = onScreen ? 0.95 + 0.15 * (v / panel.height + 0.5) : 0.8 + 0.4 * Math.max(0, -u / panel.width + 0.3);
    builder.push({
      position: placeOnPanel(panel, u, v, onScreen ? 0.004 : 0),
      scale: [sigma, sigma, 0.0015],
      normal,
      color: shade(color, k),
      opacity: 1,
    });
    placed++;
  }
}

export function devicesScene(count: number, seed = 53): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);
  const [phoneCount, browserCount, serverCount, linkCount, haloCount] = apportion(count, [0.34, 0.45, 0.08, 0.08, 0.05]) as [
    number, number, number, number, number,
  ];
  panelSplats(builder, PHONE, phoneCount);
  panelSplats(builder, BROWSER, browserCount);

  // The self-hosted server: a small stacked box with status lights.
  const server = { x: 0.05, y: -0.88, z: 0.15, w: 0.5, h: 0.24, d: 0.32 };
  const sigma = surfaceSigma(2 * (server.w * server.h + server.w * server.d + server.h * server.d), serverCount);
  for (let i = 0; i < serverCount; i++) {
    const face = Math.floor(random() * 3);
    const sign = random() < 0.5 ? -1 : 1;
    let p: Vec3, normal: Vec3;
    const a = random() - 0.5, b = random() - 0.5;
    if (face === 0) {
      p = [a * server.w, b * server.h, (sign * server.d) / 2];
      normal = [0, 0, sign];
    } else if (face === 1) {
      p = [a * server.w, (sign * server.h) / 2, b * server.d];
      normal = [0, sign, 0];
    } else {
      p = [(sign * server.w) / 2, a * server.h, b * server.d];
      normal = [sign, 0, 0];
    }
    let color = shade(palette.graphite, face === 1 && sign > 0 ? 1.9 : 1.3);
    if (face === 0 && sign > 0) {
      const slot = Math.abs(p[1]) < 0.012 || Math.abs(Math.abs(p[1]) - 0.08) < 0.006;
      if (slot) color = shade(palette.graphite, 0.6);
      if (p[0] > 0.15 && p[0] < 0.2 && Math.abs(p[1] - 0.04) < 0.015) color = palette.income;
      if (p[0] > 0.15 && p[0] < 0.2 && Math.abs(p[1] + 0.04) < 0.015) color = palette.copperDark;
    }
    builder.push({
      position: [server.x + p[0], server.y + p[1], server.z + p[2]],
      scale: [sigma, sigma, 0.0015],
      normal,
      color,
      opacity: 0.97,
    });
  }

  // Sync arcs from the server to each device, drawn as glowing dotted beads.
  const ends: Vec3[] = [placeOnPanel(PHONE, 0, -PHONE.height / 2), placeOnPanel(BROWSER, 0.2, -BROWSER.height / 2)];
  for (let i = 0; i < linkCount; i++) {
    const end = ends[i % 2]!;
    const t = Math.floor(random() * 18) / 18 + random() * 0.025;
    const start: Vec3 = [server.x, server.y + server.h / 2, server.z];
    const mid: Vec3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2 - 0.05, (start[2] + end[2]) / 2 + 0.35];
    const q = (a: number, b: number, c: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
    builder.push({
      position: [q(start[0], mid[0], end[0]), q(start[1], mid[1], end[1]), q(start[2], mid[2], end[2])],
      scale: [0.007, 0.007, 0.007],
      color: i % 2 ? palette.copperDark : palette.glow2,
      opacity: 0.85,
    });
  }

  halo(
    builder,
    haloCount,
    random,
    () => (random() < 0.4 ? placeOnPanel(PHONE, 0, 0) : placeOnPanel(BROWSER, 0, 0)),
    [palette.glow1, palette.invest, palette.glow3, palette.glow2],
    { spread: 0.3, size: [0.015, 0.05], opacity: [0.01, 0.035] },
  );

  return builder.build();
}
