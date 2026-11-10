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
