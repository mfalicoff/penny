---
category: Feedback
---

# Sheet

Bottom sheet with a grabber: × on the left, a copper ✓ (save) on the right, and a title or `center` control (for example the Expense / Income / Invest segmented control). Put it at the bottom of a `Screen` over a dimmed backdrop (`var(--pk-dim)`). Use `grouped` for form sheets made of lists.

## Example

```tsx
<Sheet confirm center={<SegmentedControl options={["Expense", "Income", "Invest"]} value="Expense" />}>
  <AmountEntry value="74.40" />
</Sheet>
```
