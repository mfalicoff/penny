---
category: Money
---

# HeroAmount

The one big number that leads a screen; the cents are smaller and muted. On Home it is **Left to spend**, with projected money (amber dot) underneath. On a household it is "you're owed" with `tone="income"`. Use one per screen.

## Example

```tsx
<HeroAmount label="Left to spend" value={1116.65} sub={<><b>$3,366.65</b> projected with expected pay</>} subPending />
```
