---
category: Layout
---

# ListRow

Generic row for settings, people, schedules and pickers. `value` is the secondary text on the right, `trailing` takes a Switch, Badge or Money, and `compact` gives settings density. Use `destructive` for Sign out and Remove.

## Example

```tsx
<List>
  <ListRow compact leading={<Icon name="sunny" />} title="Appearance" value="System" chevron />
  <ListRow compact title="Face ID lock" trailing={<Switch checked />} />
</List>
```
