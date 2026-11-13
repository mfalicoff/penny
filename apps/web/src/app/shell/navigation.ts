import type { IconName } from "../../design/Icon";

/** Paths the shell links to. Each is a legacy URL kept from the Expo app or a new web-only page. */
export type NavPath = "/" | "/transactions" | "/insights" | "/households" | "/trips" | "/recurring" | "/accounts" | "/categories" | "/settings";

export interface NavItem {
  to: NavPath;
  label: string;
  icon: IconName;
  /** Second key after G, e.g. "h" for G H. */
  key?: string;
  /** Shown in the phone tab bar. */
  tab?: boolean;
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}

/**
 * The web navigation (MAZ-132 web shell): Home, Activity and Insights; Together (shared
 * households and trips); Manage (Recurring, Accounts, Categories). Settings sits in the account
 * footer. Phones show Home, Activity, Shared and Trips as tabs, and the rest under More.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: "/", label: "Home", icon: "home", key: "h", tab: true },
      { to: "/transactions", label: "Activity", icon: "list", key: "a", tab: true },
      { to: "/insights", label: "Insights", icon: "pie-chart", key: "i" },
    ],
  },
  {
    heading: "Together",
    items: [
      { to: "/households", label: "Shared", icon: "people", key: "s", tab: true },
      { to: "/trips", label: "Trips", icon: "airplane", key: "t", tab: true },
    ],
  },
  {
    heading: "Manage",
    items: [
      { to: "/recurring", label: "Recurring", icon: "repeat", key: "r" },
      { to: "/accounts", label: "Accounts", icon: "wallet" },
      { to: "/categories", label: "Categories", icon: "pricetag" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
export const TAB_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.tab);

/** G then a key, as shown in the sidebar ("G H"). */
export const goShortcut = (item: NavItem) => (item.key ? `G ${item.key.toUpperCase()}` : undefined);
