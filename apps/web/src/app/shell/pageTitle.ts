import { createContext, use, useEffect } from "react";

/**
 * Lets a page replace its route's static title, for titles that depend on data (a household's
 * name) or on no route at all (not found). The shell shows the override while the page is mounted.
 */
export const PageTitleContext = createContext<((title: string | null) => void) | null>(null);

export function usePageTitle(title: string | null | undefined) {
  const set = use(PageTitleContext);
  useEffect(() => {
    if (!set || !title) return;
    set(title);
    return () => {
      set(null);
    };
  }, [set, title]);
}

/**
 * The top bar's tools slot, beside the title (cards `web-home` and `web-insights` put the month
 * switcher there). Null until the shell has mounted it, so a page falls back to rendering inline.
 */
export const TopbarSlotContext = createContext<HTMLElement | null>(null);

export function useTopbarSlot(): HTMLElement | null {
  return use(TopbarSlotContext);
}

/**
 * How a page shows its title on phones (below 768px): `large` (the default large title), `hero`
 * (the page draws the name in its own hero, so the bar's title is only for screen readers: card
 * `iphone-shared`) or `inline` (the cards' collapsed navigation bar, with the title small and
 * centered: `iphone-shared-balances`, `iphone-shared-people`). Wider layouts always show it.
 */
export type PageTitleStyle = "large" | "hero" | "inline";

export const PageTitleStyleContext = createContext<((style: PageTitleStyle) => void) | null>(null);

export function usePageTitleStyle(style: PageTitleStyle) {
  const set = use(PageTitleStyleContext);
  useEffect(() => {
    if (!set) return;
    set(style);
    return () => {
      set("large");
    };
  }, [set, style]);
}
