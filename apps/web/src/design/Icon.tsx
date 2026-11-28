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

/**
 * Glyphs the year in review's cards draw inline (MAZ-292: `web-year-review`,
 * `web-year-review-share`), which the kit's Ionicons set doesn't have: share, eye, eye-off and
 * download. The same drawings, stroked in the current color.
 */
const CARD_GLYPHS = {
  share: ["M336 192h40a40 40 0 0140 40v192a40 40 0 01-40 40H136a40 40 0 01-40-40V232a40 40 0 0140-40h40M336 128l-80-80-80 80M256 321V48"],
  eye: ["M255.66 112c-77.94 0-157.89 45.11-220.83 135.33a16 16 0 00-.27 17.77C82.92 340.8 161.8 400 255.66 400c92.84 0 173.34-59.38 221.79-135.25a16.14 16.14 0 000-17.47C428.89 172.28 347.8 112 255.66 112z", "M336 256a80 80 0 11-160 0 80 80 0 01160 0z"],
  "eye-off": ["M432 448L80 64M255.66 112c-77.94 0-157.89 45.11-220.83 135.33a16 16 0 00-.27 17.77C82.92 340.8 161.8 400 255.66 400c92.84 0 173.34-59.38 221.79-135.25a16.14 16.14 0 000-17.47C428.89 172.28 347.8 112 255.66 112z"],
  download: ["M256 80v256M160 240l96 96 96-96M96 416h320"],
} as const;

export function CardGlyph({ name, size = 18, weight = 32 }: { name: keyof typeof CARD_GLYPHS; size?: number; weight?: number }) {
  return (
    <span className="icon" aria-hidden="true" style={{ width: size, height: size, ["--sw" as string]: `${String(weight)}px` }}>
      <svg viewBox="0 0 512 512" focusable="false">
        {CARD_GLYPHS[name].map((d) => (
          <path key={d} d={d} style={{ fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "var(--sw,32px)" }} />
        ))}
      </svg>
    </span>
  );
}

const strokeStyle = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: "var(--sw,32px)" } as const;

/**
 * The Rate row's arrows (MAZ-151 cards `web-add-entry-currency`, `web-entry-rate-*`). The kit's
 * Ionicons set has no swap glyph, so the cards draw Ionicons' `swap-horizontal-outline` inline;
 * this is the same drawing.
 */
export function SwapIcon({ size = 17, weight = 36 }: { size?: number; weight?: number }) {
  return (
    <span className="icon" aria-hidden="true" style={{ width: size, height: size, ["--sw" as string]: `${String(weight)}px` }}>
      <svg viewBox="0 0 512 512" focusable="false">
        <polyline points="304 48 416 160 304 272" style={strokeStyle} />
        <line x1="398.87" y1="160" x2="96" y2="160" style={strokeStyle} />
        <polyline points="208 464 96 352 208 240" style={strokeStyle} />
        <line x1="114" y1="352" x2="416" y2="352" style={strokeStyle} />
      </svg>
    </span>
  );
}

/** "Use it" beside the published rate (`web-entry-rate-edited`): Ionicons' `refresh-outline`, as the card draws it inline. */
export function RefreshIcon({ size = 12, weight = 40 }: { size?: number; weight?: number }) {
  return (
    <span className="icon" aria-hidden="true" style={{ width: size, height: size, ["--sw" as string]: `${String(weight)}px` }}>
      <svg viewBox="0 0 512 512" focusable="false">
        <path d="M320 146s24.36-12-64-12a160 160 0 10160 160" style={{ ...strokeStyle, strokeLinejoin: undefined, strokeMiterlimit: 10 }} />
        <polyline points="256 58 336 138 256 218" style={strokeStyle} />
      </svg>
    </span>
  );
}

/**
 * The Inbox (MAZ-291 cards `web-inbox-captured`, `web-capture-*`): Ionicons' `file-tray-outline`,
 * which the kit's set lacks, drawn inline as the cards draw it.
 */
export function TrayIcon({ size = 18, weight = 32 }: { size?: number; weight?: number }) {
  return (
    <span className="icon" aria-hidden="true" style={{ width: size, height: size, ["--sw" as string]: `${String(weight)}px` }}>
      <svg viewBox="0 0 512 512" focusable="false">
        <path d="M384 80H128L64 272v128a32 32 0 0032 32h320a32 32 0 0032-32V272z" style={{ ...strokeStyle, strokeLinecap: undefined }} />
        <path d="M64 272h112a80 80 0 00160 0h112" style={{ ...strokeStyle, strokeLinecap: undefined }} />
      </svg>
    </span>
  );
}

/** "Matches a receipt" and "Attach to this" (MAZ-291 cards): Ionicons' `link-outline`, drawn inline as the cards draw it. */
export function LinkIcon({ size = 14, weight = 36 }: { size?: number; weight?: number }) {
  return (
    <span className="icon" aria-hidden="true" style={{ width: size, height: size, ["--sw" as string]: `${String(weight)}px` }}>
      <svg viewBox="0 0 512 512" focusable="false">
        <path d="M208 352h-64a96 96 0 010-192h64M304 160h64a96 96 0 010 192h-64M163.29 256h187.42" style={strokeStyle} />
      </svg>
    </span>
  );
}
