---
category: Layout
---

# Screen

Device artboard: iPhone at 402×874 or iPad landscape at 1210×834, with the status bar, Dynamic Island and home indicator. Put a `Toolbar` first. Pass the `TabBar`, the search field or a `Toast` stack to `bottom`. Use `glow="copper"` behind the Home hero and `glow="green"` on a household. Content is not scrollable, so design one screenful.

## Example

```tsx
<Screen glow="copper" bottom={<TabBar active="home" />}>
  <Toolbar leading={<GlassButton label="November" icon="chevron-down" iconEnd />} trailing={<GlassButton icon="settings" ariaLabel="Settings" />} />
  <HeroAmount label="Left to spend" value={1116.65} />
</Screen>
```
