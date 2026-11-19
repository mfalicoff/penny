import type { IconName } from "../../design/Icon";

/** Paths the shell links to. */
export type NavPath = "/" | "/transactions" | "/insights" | "/households" | "/trips" | "/recurring" | "/accounts" | "/categories" | "/settings";

export interface NavItem {
  to: NavPath;
  label: string;
  icon: IconName;
  /** Second key after G, e.g. "h" for G H. */
  key?: string;
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}

const HOME: NavItem = { to: "/", label: "Home", icon: "home", key: "h" };
const ACTIVITY: NavItem = {
  to: "/transactions",
  label: "Activity",
  icon: "list",
  key: "a",
};
const INSIGHTS: NavItem = {
  to: "/insights",
  label: "Insights",
  icon: "pie-chart",
  key: "i",
};
export const SHARED: NavItem = {
  to: "/households",
  label: "Shared",
  icon: "people",
  key: "s",
};
export const TRIPS: NavItem = {
  to: "/trips",
  label: "Trips",
  icon: "airplane",
  key: "t",
};
export const RECURRING: NavItem = {
  to: "/recurring",
  label: "Recurring",
  icon: "repeat",
  key: "r",
};

/** Home, Activity and Insights: the sidebar's first section. */
export const MAIN_ITEMS: NavItem[] = [HOME, ACTIVITY, INSIGHTS];

/** Manage: Recurring, Accounts and Categories (in the sidebar, and in Settings on phones). */
export const MANAGE_ITEMS: NavItem[] = [RECURRING, { to: "/accounts", label: "Accounts", icon: "wallet" }, { to: "/categories", label: "Categories", icon: "pricetag" }];

/**
 * The web navigation (MAZ-132 web shell, MAZ-221): Home, Activity and Insights; Together (each
 * household and current or coming trip, built from data in the sidebar); Manage. Settings sits in
 * the account footer. Phones show Home, Activity, Shared and Trips as tabs beside the add button,
 * and reach Manage and Settings from Home's settings button.
 */
export const NAV_ITEMS: NavItem[] = [...MAIN_ITEMS, SHARED, TRIPS, ...MANAGE_ITEMS];
export const TAB_ITEMS: NavItem[] = [HOME, ACTIVITY, SHARED, TRIPS];

/**
 * The tab a page belongs to on phones. Insights (and its money flow) is pushed from Home, so Home
 * stays selected, as on the cards; Recurring, Accounts, Categories and Settings come from Home's
 * settings button. Receipts come from Settings too.
 */
export function tabFor(pathname: string): NavPath | null {
  if (pathname.startsWith("/transactions")) return "/transactions";
  if (pathname.startsWith("/households")) return "/households";
  if (pathname.startsWith("/trips")) return "/trips";
  return "/";
}

/** G then a key, as shown in the sidebar ("G H"). */
export const goShortcut = (item: NavItem) => (item.key ? `G ${item.key.toUpperCase()}` : undefined);
