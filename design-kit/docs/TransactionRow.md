---
category: Layout
---

# TransactionRow

Ledger entry row with category tile, title, a meta line (date · account · split) and a signed amount. Keep the `note` under the amount rare, for example "your share" on a shared expense.

## Example

```tsx
<TransactionRow category="food" title="Coffee with Mira" meta="Today · Visa · split 2 ways" amount={6.4} />
<TransactionRow category="salary" title="Payday" meta="Nov 1 · Main chequing" amount={3200} kind="income" />
```
