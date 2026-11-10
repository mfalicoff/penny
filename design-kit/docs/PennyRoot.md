---
category: Foundations
---

# PennyRoot

Wrap every design in `PennyRoot` (or put it around each `Screen`). It sets the Inter font, the page background, text color and the light or dark token set. Without it, components fall back to browser defaults.

## Example

```tsx
<PennyRoot theme="dark">
  <Screen glow="copper" bottom={<TabBar active="home" />}>…</Screen>
</PennyRoot>
```
