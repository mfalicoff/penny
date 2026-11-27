import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPreferences, reloadPreferences, setPreferences, STORAGE_KEY, usePreferences } from "../src/app/preferences";

afterEach(() => {
  localStorage.clear();
  reloadPreferences();
});

const current = () => renderHook(() => usePreferences()).result.current;

const stored = (value: unknown) => {
  localStorage.setItem(STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  reloadPreferences();
};

describe("appearance preferences", () => {
  it("falls back to the defaults for unknown or corrupt values", () => {
    stored({ theme: "sepia", reduceTransparency: "yes" });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(document.documentElement).not.toHaveAttribute("data-transparency");
    stored("{not json");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("reads values saved before Show cents and Week starts on existed, with their defaults", () => {
    stored({ theme: "dark", reduceTransparency: true });
    expect(current()).toEqual({ theme: "dark", reduceTransparency: true, showCents: true, weekStartsOn: "monday", recapDismissed: null, yearReviewDismissed: null });
    stored({ theme: "dark", reduceTransparency: true, showCents: "no", weekStartsOn: "friday" });
    expect(current()).toEqual({ theme: "dark", reduceTransparency: true, showCents: true, weekStartsOn: "monday", recapDismissed: null, yearReviewDismissed: null });
    stored({ showCents: false, weekStartsOn: "sunday" });
    expect(current()).toMatchObject({ showCents: false, weekStartsOn: "sunday" });
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    setPreferences({ theme: "light" });
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("reflects reduce transparency on the root element", () => {
    applyPreferences({ theme: "system", reduceTransparency: true, showCents: true, weekStartsOn: "monday", recapDismissed: null, yearReviewDismissed: null });
    expect(document.documentElement).toHaveAttribute("data-transparency", "reduced");
    applyPreferences({ theme: "system", reduceTransparency: false, showCents: true, weekStartsOn: "monday", recapDismissed: null, yearReviewDismissed: null });
    expect(document.documentElement).not.toHaveAttribute("data-transparency");
  });
});
