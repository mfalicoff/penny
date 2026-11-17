// A money-flow (Sankey) diagram in depth: income on the left, categories on the right.
import { SplatBuilder, type SplatCloud, type Vec3 } from "../splats/cloud.ts";
import { apportion, createRandom, lerp, mixColor, shade, smoothstep } from "../splats/random.ts";
import { halo, r2 } from "./common.ts";
import { palette } from "./palette.ts";

interface Node {
  readonly id: string;
  readonly color: Vec3;
}

const SOURCES: readonly Node[] = [
  { id: "salary", color: palette.income },
  { id: "freelance", color: mixColor(palette.income, palette.groceries, 0.45) },
];

const TARGETS: readonly Node[] = [
  { id: "home", color: palette.home },
  { id: "groceries", color: palette.groceries },
  { id: "food", color: palette.food },
  { id: "transport", color: palette.transport },
  { id: "invested", color: palette.invest },
  { id: "left", color: palette.copperDark },
];

/** Demo amounts (thousands), the same shape as the README's money-flow screenshot. */
export const FLOWS: readonly { from: string; to: string; amount: number }[] = [
  { from: "salary", to: "home", amount: 1.5 },
  { from: "salary", to: "groceries", amount: 0.7 },
  { from: "salary", to: "food", amount: 0.55 },
  { from: "salary", to: "invested", amount: 0.8 },
  { from: "salary", to: "left", amount: 0.05 },
  { from: "freelance", to: "transport", amount: 0.35 },
  { from: "freelance", to: "left", amount: 1.05 },
];

const LEFT = -1.18;
const RIGHT = 1.18;
const BAR = 0.045;
const HEIGHT = 1.9;
const GAP = 0.07;

interface Slot {
  y0: number;
  y1: number;
}

function layout(nodes: readonly Node[], totals: Map<string, number>, scale: number): Map<string, Slot> {
  const height = [...totals.values()].reduce((a, b) => a + b, 0) * scale + GAP * (nodes.length - 1);
  let y = height / 2;
  const slots = new Map<string, Slot>();
  for (const node of nodes) {
    const h = (totals.get(node.id) ?? 0) * scale;
    slots.set(node.id, { y0: y - h, y1: y });
    y -= h + GAP;
  }
  return slots;
}

export function flowScene(count: number, seed = 23): SplatCloud {
  const random = createRandom(seed);
  const builder = new SplatBuilder(count);

  const out = new Map<string, number>();
  const into = new Map<string, number>();
  for (const f of FLOWS) {
    out.set(f.from, (out.get(f.from) ?? 0) + f.amount);
    into.set(f.to, (into.get(f.to) ?? 0) + f.amount);
  }
  const total = [...out.values()].reduce((a, b) => a + b, 0);
  const scale = (HEIGHT - GAP * (TARGETS.length - 1)) / total;
  const sources = layout(SOURCES, out, scale);
  const targets = layout(TARGETS, into, scale);

  // Each flow takes the next band of its source and target, top to bottom.
  const sourceCursor = new Map([...sources].map(([k, s]) => [k, s.y1]));
  const targetCursor = new Map([...targets].map(([k, s]) => [k, s.y1]));
  const ribbons = FLOWS.map((f, index) => {
    const h = f.amount * scale;
    const s1 = sourceCursor.get(f.from)!;
    const t1 = targetCursor.get(f.to)!;
    sourceCursor.set(f.from, s1 - h);
    targetCursor.set(f.to, t1 - h);
    return {
      index,
      s: { y0: s1 - h, y1: s1 },
      t: { y0: t1 - h, y1: t1 },
      from: SOURCES.find((n) => n.id === f.from)!.color,
      to: TARGETS.find((n) => n.id === f.to)!.color,
      area: h * (RIGHT - LEFT),
    };
  });

  const [ribbonCount, nodeCount, haloCount] = apportion(count, [0.72, 0.18, 0.1]) as [number, number, number];

  const perRibbon = apportion(ribbonCount, ribbons.map((r) => r.area + 0.04));
  ribbons.forEach((ribbon, i) => {
    const n = perRibbon[i]!;
    const sigma = Math.sqrt(ribbon.area / n) * 0.95;
    const depth = (ribbon.index - (ribbons.length - 1) / 2) * 0.07;
    for (let k = 0; k < n; k++) {
      const [a, across] = r2(k);
      const x = lerp(LEFT + BAR, RIGHT - BAR, a);
      const blend = smoothstep(0, 1, a);
      const y0 = lerp(ribbon.s.y0, ribbon.t.y0, blend);
      const y1 = lerp(ribbon.s.y1, ribbon.t.y1, blend);
      const slope = (ribbon.t.y0 + ribbon.t.y1 - ribbon.s.y0 - ribbon.s.y1) / 2;
      const z = depth * Math.sin(Math.PI * a) + (random() - 0.5) * 0.05;
      // Brighter at the band edges, like light catching a translucent ribbon.
      const edge = 1 - 4 * across * (1 - across);
      builder.push({
        position: [x, lerp(y0, y1, across), z],
        scale: [sigma * 1.6, sigma * 0.8, sigma * 0.5],
        tangent: [RIGHT - LEFT, slope * 6 * a * (1 - a), 0],
        color: shade(mixColor(ribbon.from, ribbon.to, smoothstep(0.15, 0.85, a)), 0.85 + 0.3 * edge),
        opacity: 0.5 + 0.3 * edge,
      });
    }
  });

  const nodes = [
    ...[...sources].map(([id, slot]) => ({ x: LEFT, slot, color: SOURCES.find((n) => n.id === id)!.color })),
    ...[...targets].map(([id, slot]) => ({ x: RIGHT, slot, color: TARGETS.find((n) => n.id === id)!.color })),
  ];
  const perNode = apportion(nodeCount, nodes.map((n) => n.slot.y1 - n.slot.y0));
  nodes.forEach((node, i) => {
    const n = perNode[i]!;
    const h = node.slot.y1 - node.slot.y0;
    const sigma = Math.sqrt((h * 0.16) / n) * 0.8;
    for (let k = 0; k < n; k++) {
      const y = lerp(node.slot.y0 + 0.01, node.slot.y1 - 0.01, random());
      builder.push({
        position: [node.x + (random() - 0.5) * BAR * 2, y, (random() - 0.5) * 0.16],
        scale: [sigma, sigma, sigma],
        color: shade(node.color, 0.95 + 0.2 * random()),
        opacity: 0.92,
      });
    }
  });

  halo(
    builder,
    haloCount,
    random,
    () => {
      const r = ribbons[Math.floor(random() * ribbons.length)]!;
      const a = random();
      const b = smoothstep(0, 1, a);
      return [lerp(LEFT, RIGHT, a), lerp((r.s.y0 + r.s.y1) / 2, (r.t.y0 + r.t.y1) / 2, b), 0];
    },
    [palette.income, palette.home, palette.food, palette.invest, palette.copperDark, palette.glow2],
    { spread: 0.06, size: [0.012, 0.04], opacity: [0.02, 0.07] },
  );

  return builder.build();
}
