---
category: Layout
---

# Toolbar

Top row of glass controls. Leading: a back button or the month picker. Trailing: one to three icon `GlassButton`s. Use `title` for pushed screens and sheets that have no large title.

## Example

```tsx
<Toolbar leading={<GlassButton icon="chevron-back" ariaLabel="Back" />} trailing={<GlassButton icon="ellipsis-horizontal" ariaLabel="More" />} />
```
