// The page's logo and icons, inlined at build time into the product page and the docs.
import { ICON_SVG, type IconName } from "../../../design-kit/src/icons.ts";

/** The app's leaf on a copper tile, as in the web app's sidebar. */
export const LOGO = `<svg class="logo" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="128" fill="#FF6F3F"/><g transform="translate(96 96) scale(0.625)" style="color:#fff;--sw:44px"><path d="M321.89,171.42C233,114,141,155.22,56,65.22c-19.8-21-8.3,235.5,98.1,332.7C231.89,468.92,352,461,392.5,392S410.78,228.83,321.89,171.42Z" style="fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:var(--sw)"/><path d="M173,253c86,81,175,129,292,147" style="fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:var(--sw)"/></g></svg>`;

/**
 * Inlines the app's icons (Ionicons v7 outline, MIT, from design-kit):
 * `<i data-icon="calendar"></i>` becomes the SVG, so the page needs no icon font or script.
 */
export function inlineIcons(html: string): string {
  return html
    .replace(/<i data-logo><\/i>/g, LOGO)
    .replace(/<i data-icon="([a-z-]+)"><\/i>/g, (_, name: string) => {
      const svg = ICON_SVG[name as IconName];
      if (!svg) throw new Error(`Unknown icon "${name}" (see design-kit/src/icons.ts)`);
      return `<svg class="icon" viewBox="0 0 512 512" aria-hidden="true">${svg}</svg>`;
    });
}
