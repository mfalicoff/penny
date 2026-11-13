// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declarations, extractBlock, renderTokens } from "../scripts/sync-design.ts";

const kit = readFileSync(new URL("../../../design-kit/src/styles.css", import.meta.url), "utf8");
const generated = readFileSync(new URL("../src/design/tokens.css", import.meta.url), "utf8");

describe("design tokens", () => {
  it("match design-kit/src/styles.css (run npm run design:sync after a kit change)", () => {
    expect(generated).toBe(renderTokens(kit));
  });

  it("override only tokens that exist in light, so dark never introduces a new name", () => {
    const light = new Set(declarations(extractBlock(kit, ":root, .pk-root")).map(([name]) => name));
    const dark = declarations(extractBlock(kit, ".pk-dark")).map(([name]) => name);
    expect(dark.length).toBeGreaterThan(10);
    expect(dark.filter((name) => !light.has(name))).toEqual([]);
  });

  it("lets Settings pin light or dark over the system appearance", () => {
    expect(generated).toContain(':root:not([data-theme="light"]) {');
    expect(generated).toContain(':root[data-theme="dark"] {\n  color-scheme: dark;');
    expect(generated).toContain(':root[data-theme="light"] {\n  color-scheme: light;');
    const pinned = generated.slice(generated.indexOf(':root[data-theme="dark"]'));
    const dark = declarations(extractBlock(kit, ".pk-dark"));
    for (const [name, value] of dark) expect(pinned).toContain(`${name}: ${value};`);
  });

  it("rejects unexpected declarations in a token block", () => {
    expect(() => declarations("--pk-a: 1; color: red;")).toThrow(/unexpected declaration/);
    expect(() => extractBlock(".x { }", ".pk-dark")).toThrow(/no ".pk-dark" block/);
  });
});
