import { describe, expect, it } from "vitest";
import { morphBetween, sceneIndex, stageAt, STAGES } from "../src/choreography.ts";
import { SCENE_IDS } from "../src/scenes/ids.ts";
import { identity, lookAt, perspective, transformPoint, translation } from "../src/splats/mat4.ts";
import { morphedViewZ, morphProgress, STAGGER } from "../src/splats/morph.ts";
import { packScenes } from "../src/splats/pack.ts";
import { encodePly } from "../src/splats/ply.ts";
import { DepthSorter } from "../src/splats/sort.ts";
import { buildScenes } from "../src/scenes/index.ts";

describe("DepthSorter", () => {
  it("orders far to near (most negative view z first)", () => {
    const z = [-1, -5, -3, -2, -4];
    const order = new DepthSorter(z.length).sort((i) => z[i]!, new Uint32Array(z.length));
    expect([...order]).toEqual([1, 4, 2, 3, 0]);
  });

  it("handles equal depths", () => {
    const order = new DepthSorter(3).sort(() => -1, new Uint32Array(3));
    expect([...order].sort()).toEqual([0, 1, 2]);
  });
});

describe("morph", () => {
  it("starts at scene A and ends at scene B for every delay", () => {
    for (const delay of [0, 0.3, 1]) {
      expect(morphProgress(0, delay)).toBe(0);
      expect(morphProgress(1, delay)).toBe(1);
    }
    // Late splats are still waiting when early ones are half way.
    expect(morphProgress(STAGGER * 0.5, 0)).toBeGreaterThan(morphProgress(STAGGER * 0.5, 1));
  });

  it("depth follows the splat from A to B", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([0, 0, -2]);
    const view = lookAt([0, 0, 5], [0, 0, 0]);
    expect(morphedViewZ(a, b, 0, 0.5, 0, identity(), identity(), view)).toBeCloseTo(-5);
    expect(morphedViewZ(a, b, 0, 0.5, 1, identity(), identity(), view)).toBeCloseTo(-7);
    expect(morphedViewZ(a, b, 0, 0.5, 0, translation(0, 0, 1), identity(), view)).toBeCloseTo(-4);
  });
});

describe("camera", () => {
  it("looks down −z at the target, and the lens shift moves the image", () => {
    const view = lookAt([0, 0, 4], [0, 0, 0]);
    expect(transformPoint(view, 0, 0, 0)).toEqual([0, 0, -4]);
    const shifted = perspective(1, 1, 0.1, 10, 0.4, 0);
    const clip = [shifted[8]! * -4 + shifted[12]!, shifted[11]! * -4];
    expect(clip[0]! / clip[1]!).toBeCloseTo(0.4);
  });
});

describe("choreography", () => {
  const anchors = [
    { scroll: 0, stage: 1 },
    { scroll: 1000, stage: 2 },
    { scroll: 2000, stage: 3 },
  ];

  it("holds each section's scene and morphs in between", () => {
    expect(stageAt(0, anchors)).toBe(1);
    expect(stageAt(200, anchors)).toBe(1);
    expect(stageAt(500, anchors)).toBeCloseTo(1.5);
    expect(stageAt(800, anchors)).toBe(2);
    expect(stageAt(5000, anchors)).toBe(3);
    expect(stageAt(10, [])).toBe(1);
  });

  it("splits a stage into the scenes it morphs between", () => {
    expect(morphBetween(1)).toEqual({ fromStage: 1, toStage: 1, t: 0 });
    expect(morphBetween(2.25)).toEqual({ fromStage: 2, toStage: 3, t: 0.25 });
    expect(morphBetween(99)).toEqual({ fromStage: STAGES.length - 1, toStage: STAGES.length - 1, t: 0 });
  });

  it("names only scenes that exist", () => {
    STAGES.forEach((_, stage) => expect(sceneIndex(stage)).toBeGreaterThanOrEqual(0));
    expect(SCENE_IDS[sceneIndex(0)]).toBe("nebula");
  });
});

describe("packing and export", () => {
  const scenes = buildScenes(3000);

  it("lays scenes out in blocks of rows the shader can address", () => {
    const packed = packScenes(scenes);
    expect(packed.rows).toBe(Math.ceil(3000 / packed.width));
    expect(packed.centers.length).toBe(packed.width * packed.rows * scenes.length * 4);
    // Splat 7 of scene 2 sits at texel 7 of the scene's first row, with the shared delay.
    const t = 2 * packed.rows * packed.width + 7;
    expect(packed.centers[t * 4]).toBe(scenes[2]!.positions[7 * 3]);
    expect(packed.centers[t * 4 + 3]).toBe(packed.delays[7]);
    expect(packed.covA[t * 4]).toBeGreaterThan(0);
  });

  it("writes a standard 3DGS .ply", () => {
    const ply = encodePly(scenes[1]!);
    const text = new TextDecoder().decode(ply.subarray(0, 600));
    const headerEnd = text.indexOf("end_header\n") + "end_header\n".length;
    expect(text.startsWith("ply\nformat binary_little_endian 1.0\nelement vertex 3000\n")).toBe(true);
    expect(text).toContain("property float f_dc_0");
    expect(text).toContain("property float rot_3");
    expect(ply.length).toBe(headerEnd + 3000 * 17 * 4);
    const first = new DataView(ply.buffer, headerEnd);
    expect(first.getFloat32(0, true)).toBeCloseTo(scenes[1]!.positions[0]!);
    expect(Math.exp(first.getFloat32(10 * 4, true))).toBeCloseTo(scenes[1]!.scales[0]!, 5);
  });
});
