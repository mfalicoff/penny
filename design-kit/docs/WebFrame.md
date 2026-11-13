---
category: Web
---

# WebFrame

Desktop browser artboard (1440×900) with window chrome, an optional `sidebar` and the main column. Put `TopBar` first in children, then a `<div style={{ padding: "22px 32px 0" }}>` body. Use `glow` on Home (copper) and households (green). Pass a `Dialog` as `overlay` for modal flows. Signed-out pages omit `sidebar`.

## Example

```tsx
<WebFrame url="penny.example.com/activity" sidebar={<WebSidebar active="activity" sections={sections} />}>
  <TopBar title="Activity" month="November 2026" />
</WebFrame>
```
