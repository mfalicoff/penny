---
category: Web
---

# TopBar

Page header for web: the title (plus `back` on detail pages), an optional month switcher, the ⌘K search and one copper primary action (default "Add entry", N). Extra `actions` go before the primary one.

## Example

```tsx
<TopBar title="Apartment" back month="November 2026" search={false} primary="Shared expense" primaryShortcut="" actions={<WebButton icon="person-add">Invite</WebButton>} />
```
