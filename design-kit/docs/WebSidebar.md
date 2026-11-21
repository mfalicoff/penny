---
category: Web
---

# WebSidebar

Persistent desktop navigation. Sections: main (Home, Activity, Insights, with G-shortcuts); Together (each household with its balance as the badge, then All households, which opens the Shared list where you join or create one; then each current or coming trip with its start date, then All trips; the All rows use the same icon as the rows above them and have no badge); Manage (Recurring, Accounts, Categories). The footer shows the account and sync status. The active item is a white raised row with a copper icon.

## Example

```tsx
<WebSidebar active="home" user={{ initials: "MF", name: "Max Falicoff", status: "Synced just now" }}
  sections={[{ items: [{ key: "home", label: "Home", icon: "home", shortcut: "G H" }] }, { heading: "Together", items: [{ key: "apt", label: "Apartment", icon: "people", badge: "$142" }] }]} />
```
