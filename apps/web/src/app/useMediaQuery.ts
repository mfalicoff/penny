import { useCallback, useSyncExternalStore } from "react";

/** The shell's desktop breakpoint (`shell.css`): the full sidebar and the desktop layouts from 1100px. */
export const WIDE = "(min-width: 1100px)";

/** The shell's tablet breakpoint (`shell.css`): below it, the phone layout with the bottom tab bar. */
export const TABLET = "(min-width: 768px)";

/**
 * Whether a CSS media query matches, kept current as the window resizes. For layouts that move a
 * region rather than restyle it (Home's flow card on phones, the Sankey on desktop), so each
 * region is rendered once. Without `matchMedia` (jsdom) it reports false: the phone layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", listener);
      return () => {
        list.removeEventListener("change", listener);
      };
    },
    [query],
  );
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, read, () => false);
}
