---
category: Web
---

# DataTable

Dense desktop table for Activity, household expenses and category comparisons. Use day `groups` with a total in the last column; put money in right-aligned columns using `Money`; use `selected` for the row open in the detail panel. Cells take any node (category icon + title, Badge, Avatar). Keep 4–6 columns; drop columns rather than wrapping text.

## Example

```tsx
<DataTable columns={[{ key: "entry", label: "Entry" }, { key: "amount", label: "Amount", align: "right" }]}
  groups={[{ label: "Today · Monday, Nov 9", total: "−$55.30", rows: [{ id: "1", cells: { entry: "Groceries", amount: <Money value={48.9} kind="expense" /> } }] }]} />
```
