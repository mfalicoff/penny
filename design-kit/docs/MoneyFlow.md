---
category: Money
---

# MoneyFlow

"Follow your money" Sankey: income sources → the month's total → expense categories, then Invested and Left over. Rules from the app: at most five categories plus "N more"; a "Beyond income" source in a deficit month; only your share of split expenses. `highlight` focuses one band and dims the rest. Fits a 358px phone card (no horizontal scrolling) or a wider iPad panel.

## Example

```tsx
<MoneyFlow sources={[{ id: "salary", label: "Salary", amount: 2800 }]}
  destinations={[{ id: "home", label: "Home", amount: 1450, color: "var(--pk-c-home)" }, { id: "left", label: "Left over", amount: 1350, color: "var(--pk-income)" }]} />
```
