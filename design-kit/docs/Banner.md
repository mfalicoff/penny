---
category: Feedback
---

# Banner

Inline status. `offline` (glass, amber icon): "Offline · 2 changes waiting". `error` (red tint): "Couldn't save. Your draft is kept." `info` (amber tint): expected money and notes. Always name the next step.

## Example

```tsx
<Banner tone="error" title="Couldn't save" message="The server didn't respond. Your draft is kept." action={<Button small>Try again</Button>} />
```
