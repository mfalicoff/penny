import { describe, expect, it } from "vitest";
import { covariance, quaternionFromNormal, SplatBuilder } from "../src/splats/cloud.ts";
import { apportion, createRandom } from "../src/splats/random.ts";

describe("quaternionFromNormal", () => {
  it("is the identity for the default orientation", () => {
    const [w, x, y, z] = quaternionFromNormal([0, 0, 1], [1, 0, 0]);
    expect(w).toBeCloseTo(1);
    expect([x, y, z].map(Math.abs).every((v) => v < 1e-9)).toBe(true);
  });

  it("maps local z onto the normal", () => {
    const q = quaternionFromNormal([1, 0, 0], [0, 1, 0]);
    const cov = new Float32Array(6);
    // A splat flat along its normal has almost no variance along that normal.
    covariance([0.1, 0.1, 0.001], 0, q, 0, cov, 0);
    expect(cov[0]).toBeCloseTo(0.000001, 6);
    expect(cov[3]).toBeCloseTo(0.01, 6);
    expect(cov[5]).toBeCloseTo(0.01, 6);
  });

  it("copes with a tangent parallel to the normal", () => {
    const q = quaternionFromNormal([0, 1, 0], [0, 1, 0]);
    expect(Math.hypot(...q)).toBeCloseTo(1);
  });
});

describe("covariance", () => {
  it("is diag(scale²) without rotation", () => {
    const cov = new Float32Array(6);
    covariance([1, 2, 3], 0, [1, 0, 0, 0], 0, cov, 0);
    expect([...cov]).toEqual([1, 0, 0, 4, 0, 9]);
  });
});

describe("SplatBuilder", () => {
  it("refuses to build until it is full, and to overfill", () => {
    const builder = new SplatBuilder(1);
    expect(() => builder.build()).toThrow(/holds 0 of 1/);
    builder.push({ position: [0, 0, 0], scale: [1, 1, 1], color: [1, 0.5, 0], opacity: 1 });
    expect(builder.build().colors.slice(0, 4)).toEqual(new Uint8Array([255, 128, 0, 255]));
    expect(() => builder.push({ position: [0, 0, 0], scale: [1, 1, 1], color: [1, 1, 1], opacity: 1 })).toThrow(/full/);
  });
});

describe("random helpers", () => {
  it("are deterministic per seed", () => {
    const a = createRandom(1), b = createRandom(1), c = createRandom(2);
    const seq = (r: () => number) => Array.from({ length: 5 }, r);
    expect(seq(a)).toEqual(seq(b));
    expect(seq(createRandom(1))).not.toEqual(seq(c));
  });

  it("apportion sums to the total", () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(1001, [0.7, 0.2, 0.1]).reduce((a, b) => a + b)).toBe(1001);
  });
});
