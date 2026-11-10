# Penny iOS kit: how to build with it

Penny is a personal and shared expense tracker for iPhone and iPad (iOS 26, Liquid Glass). These components are a web reference of the native app. Design iPhone screens at 402×874, iPad landscape at 1210×834 and the desktop web app at 1440×900, using one screenful per artboard.

## Setup
- Wrap every design in `PennyRoot` (`theme="light"` or `"dark"`). It applies the Inter font, the `--pk-bg` background, text color and the dark-mode tokens. Without it, components render in browser defaults.
- Use `Screen` as the device artboard. Its order is `Toolbar` first, then `LargeTitle` or `HeroAmount`, then content. Pass `TabBar` (or a search field or `Toast` stack) to `bottom`. Use `glow="copper"` behind Home's hero and `glow="green"` on a household.

```tsx
<PennyRoot>
  <Screen glow="copper" bottom={<TabBar active="home" />}>
    <Toolbar leading={<GlassButton label="November" icon="chevron-down" iconEnd />}
      trailing={<GlassButton icon="settings" ariaLabel="Settings" />} />
    <HeroAmount label="Left to spend" value={1116.65} sub={<><b>$3,366.65</b> projected with expected pay</>} subPending />
    <FlowCard spent={1883.35} invested={200} left={1116.65} action={<Pill label="Insights" icon="pie-chart" />} />
    <SectionHeader title="Recent" action="See all" />
    <List><TransactionRow category="groceries" title="Groceries" meta="Today · Main chequing" amount={48.9} /></List>
  </Screen>
</PennyRoot>
```

## Web (desktop browser)
- Use `WebFrame` with a `WebSidebar` (main: Home, Activity, Insights; Together: each household and trip; Manage) and `TopBar` first in its children (title, month, ⌘K search, one copper primary action). Put content in a `<div style={{ padding: "22px 32px 0" }}>`.
- Web replaces sheets with a centered `Dialog` (passed as `WebFrame` `overlay`), and long lists with `DataTable` (day groups with totals, right-aligned money). Open entry details in a right-hand side panel (`Card inset={false}`), not a new page.
- Use `WebButton` (36px) on web instead of `Button`, and `Kbd` to show keyboard shortcuts next to the actions they trigger.

## Color rules (one meaning per color)
- `--pk-tint` (copper) is for actions and selection only: the primary button, the save ✓, the + button, switches and links. Use one copper primary action per screen.
- `--pk-income` (green) means income, money left, or money owed to you. `--pk-invest` (indigo) means investment contributions. `--pk-pending` (amber) means expected, scheduled or waiting to sync. `--pk-danger` (red) is only for errors and destructive actions.
- **Expenses use `--pk-label` with a minus sign, never red.** Let `Money` / `TransactionRow` `kind` handle sign and color.
- Categories use only `--pk-c-home`, `--pk-c-groceries`, `--pk-c-transport`, `--pk-c-food`, `--pk-c-shopping`, `--pk-c-entertainment`, `--pk-c-health` and `--pk-c-other` (`CategoryIcon category="…"`). People are gray monograms (`Avatar`), never colored.

## Material and layout
- Liquid Glass (`GlassButton`, `TabBar`, `Sidebar`, `Card glass`, `Toast`, offline `Banner`) belongs only to the control layer that floats over content. Lists and money sit on solid `--pk-surface` (`List`, `Card`).
- Each screen leads with one `HeroAmount`. Keep numbers few: no grids of summary cards.
- Use 16px side margins (`List` / `Card` are inset by default), 26px card radius and 60px rows.
- Sheets (`Sheet`): × on the left, a copper ✓ on the right, a grabber, over `var(--pk-dim)`. Adding an entry uses `AmountEntry` + `Keypad` on iPhone.
- iPad: `Sidebar` on the left (Home, Activity, Insights; Together: households and trips with balances; Manage), with content in panels to its right.
- Copy states facts: "Left to spend", "you're owed $142.50", "Couldn't save. Your draft is kept." Penny records payments; it never moves money and is never linked to a bank.

## Where the truth lives
`styles.css` → `_ds_bundle.css` defines every `--pk-*` token and `pk-*` class. Prefer components over raw classes. For your own layout glue, use inline styles with `var(--pk-*)` tokens. Each component's `.prompt.md` holds its rules and an example.
