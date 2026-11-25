import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISTANCE, DURATION, EASING, PRESS, distance, duration, easeStandard, motionMode, useCountUp, useFadingHighlight, useListMotion } from "./motion";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

interface MotionTokens {
  duration: Record<string, number>;
  easing: Record<string, string>;
  distance: Record<string, number>;
  press: number;
}

describe("motion tokens (docs/design/motion.md)", () => {
  const baseline = (JSON.parse(read("../../../../contracts/design-baseline.json")) as { tokens: { motion: MotionTokens } }).tokens.motion;
  const css = read("./tokens.css");
  const token = (name: string) => new RegExp(`${name}: ([^;]+);`).exec(css)?.[1];

  it("match contracts/design-baseline.json", () => {
    expect(baseline.duration).toEqual(DURATION);
    expect(baseline.easing).toEqual(EASING);
    expect(baseline.distance).toEqual(DISTANCE);
    expect(baseline.press).toBe(PRESS);
  });

  it("match the CSS tokens from the design kit", () => {
    for (const [name, ms] of Object.entries(DURATION)) expect(token(`--pk-dur-${name}`)).toBe(`${String(ms)}ms`);
    expect(token("--pk-ease-standard")).toBe(EASING.standard);
    expect(token("--pk-ease-exit")).toBe(EASING.exit);
    for (const [name, px] of Object.entries(DISTANCE)) expect(token(`--pk-${name}`)).toBe(`${String(px)}px`);
    expect(token("--pk-press")).toBe(String(PRESS));
    expect(token("--pk-motion")).toBe("1");
  });

  it("reduced motion keeps fades at quick and moves nothing; off animates nothing", () => {
    expect(duration("emphasized", "full")).toBe(400);
    expect(duration("standard", "reduced")).toBe(150);
    expect(duration("emphasized", "reduced")).toBe(150);
    expect(duration("linger", "reduced")).toBe(1000);
    expect(distance("shift", "full")).toBe(24);
    for (const token of ["nudge", "shift", "shake"] as const) expect(distance(token, "reduced")).toBe(0);
    for (const token of ["quick", "standard", "emphasized", "linger"] as const) expect(duration(token, "off")).toBe(0);
  });

  it("the global reduced-motion rule drops distances and long durations, not every transition", () => {
    const global = read("./global.css");
    const block = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(global)?.[1] ?? "";
    expect(block).toContain("--pk-motion: 0");
    expect(block).toContain("--pk-dur-standard: var(--pk-dur-quick)");
    expect(block).toContain("--pk-dur-emphasized: var(--pk-dur-quick)");
    expect(global).not.toContain("transition-duration: 0.01ms");
  });

  it("the standard easing starts fast and settles", () => {
    expect(easeStandard(0)).toBeCloseTo(0);
    expect(easeStandard(1)).toBeCloseTo(1);
    expect(easeStandard(0.25)).toBeGreaterThan(0.5);
    let last = 0;
    for (let step = 1; step <= 20; step += 1) {
      const value = easeStandard(step / 20);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
});

describe("motion modes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.dataset.motion = "off";
  });

  it("reads off from the document, then the reduced-motion setting", () => {
    expect(motionMode()).toBe("off");
    delete document.documentElement.dataset.motion;
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener: () => undefined, removeEventListener: () => undefined }));
    expect(motionMode()).toBe("reduced");
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    expect(motionMode()).toBe("full");
  });
});

describe("useCountUp", () => {
  it("shows the new value at once with motion off or reduced", () => {
    const { result, rerender } = renderHook(({ cents }) => useCountUp(cents), { initialProps: { cents: 100 } });
    rerender({ cents: 5000 });
    expect(result.current).toEqual({ value: 5000, counting: false });
  });

  it("counts to the new value when everything moves", () => {
    delete document.documentElement.dataset.motion;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const { result, rerender } = renderHook(({ cents }) => useCountUp(cents), { initialProps: { cents: 0 } });
      rerender({ cents: 10_000 });
      expect(result.current.counting).toBe(true);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current.value).toBeGreaterThan(0);
      expect(result.current.value).toBeLessThan(10_000);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(result.current).toEqual({ value: 10_000, counting: false });
    } finally {
      vi.useRealTimers();
      document.documentElement.dataset.motion = "off";
    }
  });
});

describe("useListMotion", () => {
  const key = (item: string) => item;
  beforeEach(() => {
    delete document.documentElement.dataset.motion;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.dataset.motion = "off";
  });

  it("keeps a removed row in place while it leaves, then drops it", () => {
    const { result, rerender } = renderHook(({ items }) => useListMotion(items, key, "2026-10"), { initialProps: { items: ["a", "b", "c"] } });
    expect(result.current.animateInserts).toBe(false);
    rerender({ items: ["a", "c"] });
    expect(result.current.rows.map((row) => [row.key, row.leaving])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
    expect(result.current.animateInserts).toBe(true);
    act(() => {
      vi.advanceTimersByTime(DURATION.quick + DURATION.standard + 100);
    });
    expect(result.current.rows.map((row) => row.key)).toEqual(["a", "c"]);
  });

  it("a new list (another month, other filters) replaces rows without motion", () => {
    const { result, rerender } = renderHook(({ items, context }) => useListMotion(items, key, context), { initialProps: { items: ["a", "b"], context: "2026-10" } });
    rerender({ items: ["x"], context: "2026-09" });
    expect(result.current.rows.map((row) => row.key)).toEqual(["x"]);
    expect(result.current.animateInserts).toBe(false);
  });

  it("an undone delete comes straight back", () => {
    const { result, rerender } = renderHook(({ items }) => useListMotion(items, key, "all"), { initialProps: { items: ["a", "b"] } });
    rerender({ items: ["a"] });
    rerender({ items: ["a", "b"] });
    expect(result.current.rows.map((row) => [row.key, row.leaving])).toEqual([
      ["a", false],
      ["b", false],
    ]);
  });

  it("removes rows at once with motion off", () => {
    document.documentElement.dataset.motion = "off";
    const { result, rerender } = renderHook(({ items }) => useListMotion(items, key, "all"), { initialProps: { items: ["a", "b"] } });
    rerender({ items: ["a"] });
    expect(result.current.rows.map((row) => row.key)).toEqual(["a"]);
  });
});

describe("useFadingHighlight", () => {
  it("keeps the saved row tinted for linger after its toast goes", () => {
    vi.useFakeTimers();
    try {
      const initialProps: { saved: string | null } = { saved: "entry-1" };
      const { result, rerender } = renderHook(({ saved }) => useFadingHighlight(saved), { initialProps });
      expect(result.current).toBeNull();
      rerender({ saved: null });
      expect(result.current).toBe("entry-1");
      act(() => {
        vi.advanceTimersByTime(DURATION.linger + 10);
      });
      expect(result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
