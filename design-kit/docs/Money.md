---
category: Foundations
---

# Money

Formats CAD amounts with Penny's color rules. **Expenses use the normal text color with a minus sign, never red.** Income is green with a plus sign, investments are indigo and unsigned, and pending is amber. Pass positive numbers and let `kind` choose the sign.

## Example

```tsx
<Money value={48.9} kind="expense" />   {/* −$48.90 */}
<Money value={3200} kind="income" />    {/* +$3,200.00 */}
<Money value={200} kind="investment" />
```
