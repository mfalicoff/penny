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
