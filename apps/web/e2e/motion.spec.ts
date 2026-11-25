import type { Page } from "@playwright/test";
import { expect, motionOff, test } from "./test";
import { enterDemo, navigate, startDemo } from "./demo";

// MAZ-287: motion (docs/design/motion.md) over the demo's sample data. With motion on, a month
// change slides from the side it comes from; with reduced motion, nothing that runs moves or
// lasts longer than `quick` (fades stay). Journey tests elsewhere keep motion on and never wait on
// it; captures turn it off (`motionOff`).

interface Running {
  name: string;
  target: string;
  duration: number;
  infinite: boolean;
  moves: boolean;
}

/** Every animation and transition running now, with whether its element is out of place. */
function running(page: Page): Promise<Running[]> {
  return page.evaluate(() => {
    const identity = new Set(["none", "0px", "0px 0px", "1", "matrix(1, 0, 0, 1, 0, 0)"]);
    return document.getAnimations().flatMap((animation) => {
      if (animation.playState !== "running" || !(animation.effect instanceof KeyframeEffect) || !animation.effect.target) return [];
      const { target, pseudoElement } = animation.effect;
      const style = getComputedStyle(target, pseudoElement);
      const timing = animation.effect.getComputedTiming();
      const name = animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? animation.transitionProperty : "script";
      return [
        {
          name,
          target: `${target.tagName.toLowerCase()}.${[...target.classList].join(".")}${pseudoElement ?? ""}`,
          duration: typeof timing.duration === "number" ? timing.duration : 0,
          infinite: timing.iterations === Infinity,
          moves: !identity.has(style.translate) || !identity.has(style.scale) || !identity.has(style.transform),
        },
      ];
    });
  });
}

/** Under reduced motion: nothing running moves, and nothing but progress and the saved-row highlight lasts past `quick`. */
function expectOnlyQuickFades(animations: Running[]) {
  const offending = animations.filter((animation) => !animation.infinite && animation.name !== "background-color" && (animation.moves || animation.duration > 150));
  expect(offending).toEqual([]);
}

test.describe("motion", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "animation sampling is checked once, on chromium");

  test("a month change slides from the side it comes from, then settles", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startDemo(page);
    await enterDemo(page);
    await page.getByRole("button", { name: "Previous month" }).click();
    const earlier = await page.evaluate(() =>
      document
        .getAnimations()
        .flatMap((animation) => (animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []))
        .map((frame) => String(frame.transform ?? "")),
    );
    expect(earlier).toContain("translateX(-24px)");
    await expect.poll(async () => (await running(page)).filter((animation) => !animation.infinite).length).toBe(0);

    await page.getByRole("button", { name: "Next month" }).click();
    const later = await page.evaluate(() =>
      document
        .getAnimations()
        .flatMap((animation) => (animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : []))
        .map((frame) => String(frame.transform ?? "")),
    );
    expect(later).toContain("translateX(24px)");
  });

  test("with reduced motion, months, dialogs and switches only fade", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startDemo(page);
    await enterDemo(page);

    await page.getByRole("button", { name: "Previous month" }).click();
    expectOnlyQuickFades(await running(page));
    await page.getByRole("button", { name: "Next month" }).click();

    // Add entry (the demo's version, which explains it doesn't save) opens and closes with fades only.
    await page.getByRole("button", { name: "Add entry" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New entry" });
    await expect(dialog).toBeVisible();
    expectOnlyQuickFades(await running(page));
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toHaveCount(0);
    expectOnlyQuickFades(await running(page));

    await navigate(page, "Settings");
    await page.getByRole("link", { name: /^Appearance/ }).click();
    await page.getByRole("switch", { name: "Reduce transparency" }).click();
    expectOnlyQuickFades(await running(page));
    // The switch's thumb jumps; only its track's color fades.
    const thumb = await page.getByRole("switch", { name: "Reduce transparency" }).evaluate((element) => getComputedStyle(element, "::after").transitionDuration);
    expect(thumb).toBe("0s");
  });

  test("motion off settles everything at once, for captures", async ({ page }) => {
    await motionOff(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await startDemo(page);
    await enterDemo(page);
    await page.getByRole("button", { name: "Previous month" }).click();
    expect((await running(page)).filter((animation) => !animation.infinite)).toEqual([]);
  });
});
