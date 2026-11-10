---
category: Inputs
---

# GlassButton

Liquid Glass control for the layer above content only: toolbar icons, the month picker capsule, sheet × and ✓, and the floating +. Use `tinted` (copper) for the one primary action. Icon-only buttons need `ariaLabel`. Never use glass for content.

## Example

```tsx
<GlassButton icon="chevron-back" ariaLabel="Back" />
<GlassButton label="November" icon="chevron-down" iconEnd />
<GlassButton icon="checkmark" tinted ariaLabel="Save" />
```
