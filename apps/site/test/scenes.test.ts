import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leafAt } from "../src/scenes/coin.ts";
import { FLOW_HALF_HEIGHT, FLOW_HALF_WIDTH } from "../src/scenes/flow.ts";
import { SCENE_IDS } from "../src/scenes/ids.ts";
import { buildScene } from "../src/scenes/index.ts";
import { palette } from "../src/scenes/palette.ts";

const COUNT = 8000;
const scenes = Object.fromEntries(SCENE_IDS.map((id) => [id, buildScene(id, COUNT)]));

function digest(arrays: ArrayBufferView[]): string {
  const hash = createHash("sha256");
  for (const a of arrays) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  return hash.digest("hex");
}

/** How far a scene reaches from its centre, in world units. */
const BOUNDS = { coin: [2.2, 2.2, 1.6], flow: [FLOW_HALF_WIDTH + 0.4, FLOW_HALF_HEIGHT + 0.5, 1] } as const;

describe.each(SCENE_IDS)("%s scene", (id) => {
  const cloud = scenes[id]!;

  it("has exactly the requested number of splats", () => {
    expect(cloud.count).toBe(COUNT);
    expect(cloud.positions.length).toBe(COUNT * 3);
  });

  it("has finite centres within its bounds, positive scales and unit rotations", () => {
    const bounds = BOUNDS[id];
    for (let i = 0; i < COUNT; i++) {
      for (let k = 0; k < 3; k++) {
        const v = cloud.positions[i * 3 + k]!;
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(bounds[k]!);
        expect(cloud.scales[i * 3 + k]).toBeGreaterThan(0);
      }
      const q = cloud.rotations.subarray(i * 4, i * 4 + 4);
      expect(Math.hypot(...q)).toBeCloseTo(1, 4);
    }
  });

  it("is identical on every build", () => {
    const again = buildScene(id, COUNT);
    expect(digest([again.positions, again.scales, again.rotations, again.colors, again.normals])).toBe(
      digest([cloud.positions, cloud.scales, cloud.rotations, cloud.colors, cloud.normals]),
    );
  });

  it("lets only dust drift, so surfaces and ribbons hold still", () => {
    for (let i = 0; i < COUNT; i++) {
      if (cloud.drift[i] === 0) continue;
      expect(id).toBe("coin");
      // Dust is unlit and faint.
      expect(cloud.normals[i * 4 + 3]).toBe(0);
      expect(cloud.colors[i * 4 + 3]!).toBeLessThanOrEqual(Math.round(0.3 * 255));
    }
  });

  it("builds at the phone budget too", () => {
    expect(buildScene(id, 2000).count).toBe(2000);
  });
});

describe("coin", () => {
  const coin = scenes.coin!;

  it("embosses the leaf with its vein and stem, inside the rim", () => {
    expect(leafAt(0.1, 0.15)).not.toBe("none");
    expect(leafAt(-0.45, -0.47)).toBe("leaf");
    expect(leafAt(0.7, -0.5)).toBe("none");
    expect(leafAt(-0.7, 0.5)).toBe("none");
  });

  it("gives its metal unit-length, lit normals", () => {
    let lit = 0;
    for (let i = 0; i < COUNT; i++) {
      if (coin.normals[i * 4 + 3]! === 0) continue;
      lit++;
      expect(Math.hypot(coin.normals[i * 4]!, coin.normals[i * 4 + 1]!, coin.normals[i * 4 + 2]!)).toBeCloseTo(1, 5);
    }
    expect(lit / COUNT).toBeGreaterThan(0.85);
  });

  it("gives the face one colour, so only the lighting varies it", () => {
    const faces = new Set<string>();
    for (let i = 0; i < COUNT; i++) {
      const front = coin.normals[i * 4 + 2]! > 0.95 && coin.positions[i * 3 + 2]! > 0;
      const metal = coin.normals[i * 4 + 3]! === 1;
      if (front && metal && Math.hypot(coin.positions[i * 3]!, coin.positions[i * 3 + 1]!) < 0.85) {
        faces.add(coin.colors.subarray(i * 4, i * 4 + 4).join());
      }
    }
    expect(faces.size).toBe(1);
  });

  it("splits splats on the leaf's outline into smaller ones", () => {
    const sizes = new Set<number>();
    for (let i = 0; i < COUNT; i++) {
      const onFace = coin.positions[i * 3 + 2]! > 0.05 && Math.hypot(coin.positions[i * 3]!, coin.positions[i * 3 + 1]!) < 0.85;
      if (onFace && coin.normals[i * 4 + 3]! > 0) sizes.add(Math.round(coin.scales[i * 3]! * 1e5));
    }
    const [small, large] = [Math.min(...sizes), Math.max(...sizes)];
    expect(small / large).toBeCloseTo(0.5, 1);
  });

  it("keeps its dust soft and faint", () => {
    for (let i = 0; i < COUNT; i++) {
      if (coin.normals[i * 4 + 3]! > 0) continue;
      expect(coin.colors[i * 4 + 3]!).toBeLessThanOrEqual(Math.round(0.42 * 255));
    }
  });
});

describe("flow ribbons", () => {
  const flow = scenes.flow!;

  it("are unlit light, with even cores and soft edges", () => {
    let core = 0, soft = 0;
    for (let i = 0; i < COUNT; i++) {
      expect(flow.normals[i * 4 + 3]).toBe(0);
      const alpha = flow.colors[i * 4 + 3]!;
      if (alpha >= 12) core++;
      else if (alpha > 0) soft++;
    }
    // Overlapping, the core splats sum to a solid band; the outer rows fade it out.
    expect(core / COUNT).toBeGreaterThan(0.3);
    expect(soft / COUNT).toBeGreaterThan(0.2);
  });

  it("start in income green and end in the categories' colours", () => {
    const near = (i: number, color: readonly number[]) =>
      Math.hypot(flow.colors[i * 4]! / 255 - color[0]!, flow.colors[i * 4 + 1]! / 255 - color[1]!, flow.colors[i * 4 + 2]! / 255 - color[2]!) < 0.2;
    let left = 0, leftGreen = 0;
    for (let i = 0; i < COUNT; i++) {
      if (flow.positions[i * 3]! < -FLOW_HALF_WIDTH * 0.7 && flow.colors[i * 4 + 3]! > 10) {
        left++;
        if (near(i, palette.income)) leftGreen++;
      }
    }
    expect(leftGreen / left).toBeGreaterThan(0.9);
  });
});
