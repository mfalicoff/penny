---
category: Navigation
---

# Sidebar

iPad floating glass sidebar. Sections: the main destinations (Home, Activity, Insights); Together (each household and trip with its balance); and Manage (Recurring, Accounts, Categories). Place it at the left of an iPad `Screen`, 10px from the edges.

## Example

```tsx
<Sidebar active="home" user={{ initials: "MF", name: "Max", status: "Synced just now" }}
  sections={[{ items: [{ key: "home", label: "Home", icon: "home" }] }, { heading: "Together", items: [{ key: "apt", label: "Apartment", icon: "people", badge: "$142" }] }]} />
```
