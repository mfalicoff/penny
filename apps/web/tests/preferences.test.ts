import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPreferences, reloadPreferences, setPreferences, STORAGE_KEY } from "../src/app/preferences";

afterEach(() => {
  localStorage.clear();
  reloadPreferences();
});

const stored = (value: unknown) => {
  localStorage.setItem(STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  reloadPreferences();
};

describe("appearance preferences", () => {
  it.each(["amoled", "catppuccin"])("migrates the legacy %s theme to dark (MAZ-132)", (legacy) => {
    stored({ theme: legacy });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("falls back to the defaults for unknown or corrupt values", () => {
    stored({ theme: "sepia", reduceTransparency: "yes" });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(document.documentElement).not.toHaveAttribute("data-transparency");
    stored("{not json");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    setPreferences({ theme: "light" });
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("reflects reduce transparency on the root element", () => {
    applyPreferences({ theme: "system", reduceTransparency: true });
    expect(document.documentElement).toHaveAttribute("data-transparency", "reduced");
    applyPreferences({ theme: "system", reduceTransparency: false });
    expect(document.documentElement).not.toHaveAttribute("data-transparency");
  });
});
