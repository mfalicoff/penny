import { describe, expect, it } from "vitest";
import { buildScene } from "../src/scenes/index.ts";
import { compose, lookAt, perspective, rotationY, transformPoint, translation } from "../src/splats/mat4.ts";
import { layoutFor, packScene, toHalf } from "../src/splats/pack.ts";
import { encodePly } from "../src/splats/ply.ts";
import { DepthSorter, viewZ } from "../src/splats/sort.ts";
import { cameraDistance, SCENES, splatCount } from "../src/splats/stage.ts";

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

describe("viewZ", () => {
  it("is the splat's depth in front of the camera, after the scene's motion", () => {
    const points = new Float32Array([0, 0, 0, 0, 0, -2]);
    const view = lookAt([0, 0, 5], [0, 0, 0]);
    const still = compose(rotationY(0));
    expect(viewZ(points, 0, still, view)).toBeCloseTo(-5);
    expect(viewZ(points, 1, still, view)).toBeCloseTo(-7);
    expect(viewZ(points, 0, translation(0, 0, 1), view)).toBeCloseTo(-4);
    // Turned half way round, the point behind the centre comes in front of it.
    expect(viewZ(points, 1, rotationY(Math.PI), view)).toBeCloseTo(-3);
  });
});

describe("camera", () => {
  it("looks down −z at the target", () => {
    const view = lookAt([0, 0, 4], [0, 0, 0]);
    expect(transformPoint(view, 0, 0, 0)).toEqual([0, 0, -4]);
  });

  it("fits the coin into its box and the ribbons across the window", () => {
    const fov = (30 * Math.PI) / 180;
    const radiusOnScreen = (distance: number, extent: number, height: number) => (extent * height) / (2 * Math.tan(fov / 2) * distance);
    // The coin's radius covers its share of the box's half-size, whichever side is shorter.
    const coin = SCENES.coin;
    expect(radiusOnScreen(cameraDistance(coin, 600, 400), coin.extent, 400)).toBeCloseTo(200 * coin.fill);
    // The ribbons' half width covers half the window's width.
    const flow = SCENES.flow;
    expect(radiusOnScreen(cameraDistance(flow, 1440, 800), flow.extent, 800)).toBeCloseTo(720 * flow.fill);
    const proj = perspective(fov, 1, 0.1, 100);
    expect(proj[0]).toBeCloseTo(proj[5]!);
  });
});

describe("budgets", () => {
  it("are about 100 000 splats on large screens and 40 000 on small ones", () => {
    const total = (small: boolean) => splatCount(SCENES.coin, small) + splatCount(SCENES.flow, small);
    expect(total(false)).toBeLessThanOrEqual(105_000);
    expect(total(true)).toBeLessThanOrEqual(42_000);
  });

  it("scale every scene with ?splats=N, within limits", () => {
    expect(splatCount(SCENES.coin, false, 32_000)).toBe(32_000);
    expect(splatCount(SCENES.flow, false, 32_000)).toBe(20_000);
    expect(splatCount(SCENES.coin, true, 50)).toBe(SCENES.coin.splats[1]);
  });
});

describe("packing and export", () => {
  const scene = buildScene("coin", 3000);

  it("converts floats to half precision", () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(0)).toBe(0);
  });

  it("lays the scene out in rows the shader can address", () => {
    const layout = layoutFor(3000);
    expect(layout.rows).toBe(Math.ceil(3000 / layout.width));
    const packed = packScene(scene, layout);
    expect(packed.centers.length).toBe(layout.width * layout.rows * 4);
    expect(packed.centers[7 * 4]).toBe(scene.positions[7 * 3]);
    expect(packed.covA[7 * 4]).toBeGreaterThan(0);
    expect(packed.normals[7 * 4 + 3]).toBe(toHalf(scene.normals[7 * 4 + 3]!));
    expect(() => packScene(buildScene("coin", 2000), layout)).toThrow(/2000 splats/);
  });

  it("writes a standard 3DGS .ply", () => {
    const ply = encodePly(scene);
    const text = new TextDecoder().decode(ply.subarray(0, 600));
    const headerEnd = text.indexOf("end_header\n") + "end_header\n".length;
    expect(text.startsWith("ply\nformat binary_little_endian 1.0\nelement vertex 3000\n")).toBe(true);
    expect(text).toContain("property float f_dc_0");
    expect(text).toContain("property float rot_3");
    expect(ply.length).toBe(headerEnd + 3000 * 17 * 4);
    const first = new DataView(ply.buffer, headerEnd);
    expect(first.getFloat32(0, true)).toBeCloseTo(scene.positions[0]!);
    expect(Math.exp(first.getFloat32(10 * 4, true))).toBeCloseTo(scene.scales[0]!, 5);
  });
});
