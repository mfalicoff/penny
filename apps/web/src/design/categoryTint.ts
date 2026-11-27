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

/** The redesign color name (`home`, `food`, …) of a category. */
function categoryName(source: TintSource | undefined): string {
  const stored = (source?.color ?? "").toUpperCase();
  const id = source?.id ?? "";
  return REDESIGN[stored] ?? (NAMES.has(id) ? id : ALIASES[id]) ?? LEDGER_PALETTE[stored] ?? "other";
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
 * always light (MAZ-292), whatever the app's appearance, so it can't read the CSS tokens.
 */
export function categoryHex(source: TintSource | undefined): string {
  return LIGHT_HEX[categoryName(source)] ?? "#8E8A85";
}

/** The inline style that colors a `.category-dot` tile. */
export function tileStyle(source: TintSource | undefined): CSSProperties {
  return { "--tile": categoryTint(source) } as CSSProperties;
}
