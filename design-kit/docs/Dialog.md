---
category: Web
---

# Dialog

Centered desktop dialog; it replaces bottom sheets on web. Header: title, optional `headerExtra` (for example the Expense / Income / Invest SegmentedControl) and ×. Footer: a keyboard `hint` on the left and `actions` on the right. Pass it to `WebFrame` `overlay`.

## Example

```tsx
<Dialog title="New entry" hint={<><Kbd>⌘↵</Kbd> save · <Kbd>Esc</Kbd> cancel</>} actions={<><WebButton>Cancel</WebButton><WebButton primary>Add expense</WebButton></>}>
  <AmountEntry value="74.40" />
</Dialog>
```
