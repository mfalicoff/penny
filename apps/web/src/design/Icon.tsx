import { ICON_SVG, type IconName } from "@design-kit/src/icons";

export type { IconName };

interface IconProps {
  name: IconName;
  /** Size in px. Defaults to 22, as in the design kit. */
  size?: number;
  /** Accessible name. Without one the icon is decorative and hidden from assistive technology. */
  label?: string;
  /** Stroke weight in the 512 viewBox: 36 regular, 44 semibold. */
  weight?: number;
}

/** Ionicons v7 outline glyph from design-kit/src/icons.ts (MIT). */
export function Icon({ name, size = 22, label, weight = 36 }: IconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span
      className="icon"
      {...a11y}
      style={{ width: size, height: size, ["--sw" as string]: `${weight}px` }}
      // The markup is the design kit's static, generated glyph data, never user input.
      dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 512 512" focusable="false">${ICON_SVG[name]}</svg>` }}
    />
  );
}

/**
 * The cards' envelope (`web-forgot-password`, `web-invite-email`). The kit's Ionicons set has no
 * mail glyph, so the cards draw Ionicons' `mail-outline` inline; this is the same drawing.
 */
export function MailIcon({ size = 20 }: { size?: number }) {
  return (
    <span className="icon" aria-hidden="true" style={{ width: size, height: size, ["--sw" as string]: "32px" }}>
      <svg viewBox="0 0 512 512" focusable="false">
        <rect x="48" y="96" width="416" height="320" rx="40" ry="40" style={{ fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "var(--sw,32px)" }} />
        <polyline points="112 160 256 272 400 160" style={{ fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "var(--sw,32px)" }} />
      </svg>
    </span>
  );
}

/**
 * The recap's sparkles (MAZ-292 cards `web-recap`, `web-home-recap`). The kit's Ionicons set has no
 * sparkles glyph, so the cards draw it inline; this is the same drawing.
 */
export function SparklesIcon({ size = 20 }: { size?: number }) {
  return (
    <span className="icon" aria-hidden="true" style={{ width: size, height: size }}>
      <svg viewBox="0 0 512 512" focusable="false">
        <path d="M224 48c16 110 58 152 168 168-110 16-152 58-168 168-16-110-58-152-168-168 110-16 152-58 168-168zM400 336c6 40 24 58 64 64-40 6-58 24-64 64-6-40-24-58-64-64 40-6 58-24 64-64z" fill="currentColor" />
      </svg>
    </span>
  );
}
