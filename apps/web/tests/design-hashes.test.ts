// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rehash } from "../scripts/design-hashes.ts";

describe("design-baseline hashes (npm run design:hashes)", () => {
  it("sets the hash of every card, control and source from its file, and lists what changed", () => {
    const baseline = {
      specimens: [{ sourcePath: "card.html", sha256: "old" }],
      controls: [{ docPath: "Button.md", sha256: "doc" }],
      sources: [
        { path: "visual-acceptance.md", sha256: "stale" },
        { path: "render.mjs", sha256: "hash:render.mjs" },
      ],
    };
    const changed = rehash(baseline, (path) => `hash:${path}`);
    expect(changed).toEqual(["card.html", "Button.md", "visual-acceptance.md"]);
    expect(baseline.specimens[0]?.sha256).toBe("hash:card.html");
    expect(baseline.controls[0]?.sha256).toBe("hash:Button.md");
    expect(baseline.sources.map((source) => source.sha256)).toEqual(["hash:visual-acceptance.md", "hash:render.mjs"]);
    expect(rehash(baseline, (path) => `hash:${path}`)).toEqual([]);
  });
});
