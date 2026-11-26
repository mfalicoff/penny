import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clipFiles, sourcesFor } from "../src/clips.ts";
import { CLIPS } from "../video/src/clips.ts";

const site = join(import.meta.dirname, "..");
const assets = join(site, "src/assets/clips");
const files = readdirSync(assets);
const html = readFileSync(join(site, "index.html"), "utf8");

describe("rendered clips", () => {
  it("are all clips the pipeline knows", () => {
    const ids = new Set(CLIPS.map((clip) => clip.id));
    for (const file of files) expect(ids, file).toContain(file.replace(/(-720|-poster)?\.(webm|mp4|webp)$/, ""));
  });

  describe.each(CLIPS.filter((clip) => files.some((file) => file.startsWith(`${clip.id}.`))).map((clip) => [clip.id, clip] as const))("%s", (id, clip) => {
    const size = (file: string) => statSync(join(assets, file)).size;

    it("has both formats and a poster", () => {
      for (const file of [`${id}.webm`, `${id}.mp4`, `${id}-poster.webp`]) expect(files).toContain(file);
      if (clip.small) for (const file of [`${id}-720.webm`, `${id}-720.mp4`]) expect(files).toContain(file);
    });

    it("stays within its size budget", () => {
      expect(size(`${id}.webm`)).toBeLessThanOrEqual(clip.budget.webm);
      expect(size(`${id}.mp4`)).toBeLessThanOrEqual(clip.budget.mp4);
      if (clip.small) {
        expect(size(`${id}-720.webm`)).toBeLessThanOrEqual(clip.budget.smallWebm ?? 0);
        expect(size(`${id}-720.mp4`)).toBeLessThanOrEqual(clip.budget.smallMp4 ?? 0);
      }
    });
  });
});

describe("the page's clip slots", () => {
  const slots = [...html.matchAll(/data-clip="([a-z-]+)"/g)].map((match) => match[1]!);

  it("each name a clip the pipeline knows, once", () => {
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots).size).toBe(slots.length);
    for (const id of slots) expect(CLIPS.map((clip) => clip.id)).toContain(id);
  });

  it("keep captions short and within the clip", () => {
    for (const [, id, body] of html.matchAll(/<ol class="clip-captions" data-clip-captions="([a-z-]+)" hidden>([\s\S]*?)<\/ol>/g)) {
      expect(slots, `captions for "${id}" without its slot`).toContain(id);
      const clip = CLIPS.find((candidate) => candidate.id === id)!;
      const items = [...body!.matchAll(/<li data-at="([\d.]+)">([^<]+)<\/li>/g)];
      expect(items.length, id).toBeGreaterThan(0);
      expect(items.length, id).toBeLessThanOrEqual(2);
      for (const [, at, text] of items) {
        expect(Number(at)).toBeLessThan(clip.seconds);
        expect(text!.trim().split(/\s+/).length, text).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe("clip sources", () => {
  const urls = {
    "./assets/clips/a.webm": "/a.webm",
    "./assets/clips/a.mp4": "/a.mp4",
    "./assets/clips/a-720.webm": "/a-720.webm",
    "./assets/clips/a-720.mp4": "/a-720.mp4",
    "./assets/clips/a-poster.webp": "/a.webp",
    "./assets/clips/b.mp4": "/b.mp4",
  };

  it("list AV1 before H.264, full size for wide windows first", () => {
    expect(sourcesFor(clipFiles("a", urls))).toEqual([
      { src: "/a.webm", type: 'video/webm; codecs="av01.0.08M.08"', media: "(min-width: 701px)" },
      { src: "/a.mp4", type: 'video/mp4; codecs="avc1.640028"', media: "(min-width: 701px)" },
      { src: "/a-720.webm", type: 'video/webm; codecs="av01.0.04M.08"' },
      { src: "/a-720.mp4", type: 'video/mp4; codecs="avc1.640028"' },
    ]);
  });

  it("need no media query without a half-size variant", () => {
    expect(sourcesFor(clipFiles("b", urls))).toEqual([{ src: "/b.mp4", type: 'video/mp4; codecs="avc1.640028"' }]);
  });

  it("are empty for a slot with no rendered clip", () => {
    expect(sourcesFor(clipFiles("overview", urls))).toEqual([]);
  });
});
