import type { CSSProperties } from "react";

/**
 * Category tiles (MAZ-222): the cards draw each row's icon as a filled tile in the category's
 * color with a white glyph, green for income and indigo for investments. A category color is
 * always one of the redesign's eight (`--pk-c-*`), never a meaning color, so a category can't
 * take the copper action tint or read as income.
 *
 * The ledger stores a category color as `#RRGGBB`. The default categories, and many existing
 * ledgers, store the older ledger palette (`palette` in the domain, copper `#E47850` among
 * them); those map onto the redesign color of the default category that uses them, as the
 * native app does (`CategoryStyle.color(forCategoryID:hex:)`). Any other color draws gray.
 */
const REDESIGN: Record<string, string> = {
  "#3B82F6": "home",
  "#0FA3A3": "groceries",
  "#64748B": "transport",
  "#E0529C": "food",
  "#A0704C": "shopping",
  "#7A8F3A": "entertainment",
  "#0E7490": "health",
  "#8E8A85": "other",
};

const NAMES = new Set(Object.values(REDESIGN));
const ALIASES: Record<string, string> = { fun: "entertainment" };

const LEDGER_PALETTE: Record<string, string> = {
  "#E47850": "food",
  "#C6953A": "home",
  "#6C9C79": "groceries",
  "#678DB1": "transport",
  "#9D83BA": "entertainment",
  "#C8798D": "shopping",
  "#89918C": "other",
};

export interface TintSource {
  /** The category id; default ids keep their own color whatever older color they store. */
  id?: string | undefined;
  /** The stored `#RRGGBB`. */
  color?: string | undefined;
  /**
   * The kind of the entry the tile stands for: income and investment entries use their meaning
   * color, as on the cards. A category on its own (pickers, Categories) keeps its category color.
   */
  entryKind?: string | undefined;
}

/** The redesign color name (`home`, `food`, …) of a category, or nothing when its color is outside both palettes. */
function mappedName(source: TintSource | undefined): string | undefined {
  const stored = (source?.color ?? "").toUpperCase();
  const id = source?.id ?? "";
  return REDESIGN[stored] ?? (NAMES.has(id) ? id : ALIASES[id]) ?? LEDGER_PALETTE[stored];
}

/** The redesign color name (`home`, `food`, …) of a category; gray for any other color. */
function categoryName(source: TintSource | undefined): string {
  return mappedName(source) ?? "other";
}

/**
 * The person's own `#RRGGBB` for a category whose color is outside both palettes (a seeded
 * "Housing" in `#5B7DB1`), which the recap, the year in review and its share image keep instead
 * of gray (MAZ-290). Nothing for a palette color or an unreadable one.
 */
function ownHex(source: TintSource | undefined): string | undefined {
  if (mappedName(source)) return undefined;
  const stored = (source?.color ?? "").toUpperCase();
  return /^#[0-9A-F]{6}$/.test(stored) ? stored : undefined;
}

/** The CSS color of a category's tile. */
export function categoryTint(source: TintSource | undefined): string {
  if (source?.entryKind === "income") return "var(--pk-income)";
  if (source?.entryKind === "investment") return "var(--pk-invest)";
  return `var(--pk-c-${categoryName(source)})`;
}

const LIGHT_HEX = Object.fromEntries(Object.entries(REDESIGN).map(([hex, name]) => [name, hex]));

/**
 * A category's color in the light appearance, as `#RRGGBB`: the year in review's share image is
 * always light (MAZ-292), whatever the app's appearance, so it can't read the CSS tokens. A color
 * outside both palettes is the person's own (MAZ-290).
 */
export function categoryHex(source: TintSource | undefined): string {
  return ownHex(source) ?? LIGHT_HEX[categoryName(source)] ?? "#8E8A85";
}

/** The inline style that colors a `.category-dot` tile. */
export function tileStyle(source: TintSource | undefined): CSSProperties {
  return { "--tile": categoryTint(source) } as CSSProperties;
}

/**
 * The inline style of a `.category-dot` tile on the recap and the year in review: as `tileStyle`,
 * except that a color outside both palettes keeps the person's own instead of gray (MAZ-290).
 */
export function ownTileStyle(source: TintSource | undefined): CSSProperties {
  const meaning = source?.entryKind === "income" || source?.entryKind === "investment";
  const own = meaning ? undefined : ownHex(source);
  return own ? ({ "--tile": own } as CSSProperties) : tileStyle(source);
}
