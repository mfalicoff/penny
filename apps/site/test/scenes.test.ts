import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leafAt } from "../src/scenes/coin.ts";
import { rasterize } from "../src/scenes/font.ts";
import { SCENE_IDS } from "../src/scenes/ids.ts";
import { buildScenes, morphOrder } from "../src/scenes/index.ts";
import { ITEMS, SHARE, TOTAL } from "../src/scenes/receipt.ts";

const COUNT = 6000;
const scenes = buildScenes(COUNT);

function digest(arrays: ArrayBufferView[]): string {
  const hash = createHash("sha256");
  for (const a of arrays) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  return hash.digest("hex");
}

describe.each(SCENE_IDS.map((id, i) => [id, i] as const))("%s scene", (_id, index) => {
  const cloud = scenes[index]!;

  it("has exactly the requested number of splats", () => {
    expect(cloud.count).toBe(COUNT);
    expect(cloud.positions.length).toBe(COUNT * 3);
  });

  it("has finite centres within the frame, positive scales and unit rotations", () => {
    for (let i = 0; i < COUNT; i++) {
      const [x, y, z] = [cloud.positions[i * 3]!, cloud.positions[i * 3 + 1]!, cloud.positions[i * 3 + 2]!];
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      expect(Math.hypot(x, y, z)).toBeLessThan(3.2);
      for (let k = 0; k < 3; k++) expect(cloud.scales[i * 3 + k]).toBeGreaterThan(0);
      const q = cloud.rotations.subarray(i * 4, i * 4 + 4);
      expect(Math.hypot(...q)).toBeCloseTo(1, 4);
    }
  });

  it("is ordered by the shared morph order", () => {
    let previous = -Infinity;
    for (let i = 0; i < COUNT; i++) {
      const key = morphOrder(cloud.positions[i * 3]!, cloud.positions[i * 3 + 1]!);
      expect(key).toBeGreaterThanOrEqual(previous - 1e-5);
      previous = key;
    }
  });

  it("is identical on every build", () => {
    const again = buildScenes(COUNT)[index]!;
    expect(digest([again.positions, again.scales, again.rotations, again.colors])).toBe(
      digest([cloud.positions, cloud.scales, cloud.rotations, cloud.colors]),
    );
  });
});

describe("coin", () => {
  it("embosses the leaf with its vein and stem, inside the rim", () => {
    expect(leafAt(0.1, 0.15)).not.toBe("none");
    expect(leafAt(-0.45, -0.47)).toBe("leaf");
    expect(leafAt(0.7, -0.5)).toBe("none");
    expect(leafAt(-0.7, 0.5)).toBe("none");
  });
});

describe("receipt", () => {
  it("adds up: the total is the items, the share is a third", () => {
    expect(TOTAL).toBeCloseTo(ITEMS.reduce((sum, [, v]) => sum + v, 0));
    expect(TOTAL.toFixed(2)).toBe("74.40");
    expect(SHARE.toFixed(2)).toBe("24.80");
  });

  it("refuses text the font can't print", () => {
    expect(rasterize("I").length).toBeGreaterThan(0);
    expect(() => rasterize("a")).toThrow(/No glyph/);
  });
});
