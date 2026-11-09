# Penny for iOS: native redesign proposal

This proposal targets iPhone and iPad only. It replaces the warm card-heavy "web app" look (in both the current app and the [penny-redesign](../penny-redesign/README.md) Penpot proposal) with a design that feels native to iOS 26.

Each screen is a standalone HTML file with a `@dsCard` marker, so the folder can be imported straight into a Claude Design design-system project. Rendered PNGs are in [previews/](previews/).

| Card | File |
| --- | --- |
| Foundations: color, type, material, components | [system/foundations.html](system/foundations.html) |
| iPhone: Home (light, dark) | [iphone/home.html](iphone/home.html), [iphone/home-dark.html](iphone/home-dark.html) |
| iPhone: Money flow (Sankey) | [iphone/money-flow.html](iphone/money-flow.html) |
| iPhone: Activity | [iphone/activity.html](iphone/activity.html) |
| iPhone: Add expense sheet | [iphone/add-expense.html](iphone/add-expense.html) |
| iPhone: Shared household | [iphone/shared.html](iphone/shared.html) |
| iPad: Home dashboard | [ipad/home.html](ipad/home.html) |
| iPad: Activity, with a detail pane | [ipad/activity.html](ipad/activity.html) |

## Direction

1. **Use the platform, not a theme.** SF Pro with Dynamic Type styles, SF Symbols, large titles, inset-grouped lists, sheets with detents, swipe actions, and the system keyboard. The custom DM Sans and the hand-built pill pickers go away.
2. **Liquid Glass belongs on the control layer only.** The floating tab bar, toolbar buttons, the month picker, and the search field are glass. Money and lists stay on solid surfaces, so they remain readable.
3. **One number leads each screen.** Home opens with **Left to spend** as a 64pt hero. Projected money, including expected pay, sits directly under it. The four equal summary cards are gone.
4. **Color has a job.** Copper (`#E4572E`) is the single brand and action tint. Green means income, indigo means investments, amber means pending or expected, and red is reserved for errors and destructive actions. Expenses use the normal label color, not red. Category colors (blue, teal, slate, pink, brown) never reuse one of these meaning colors, so a color on screen always has one meaning.
5. **Content-tinted glow.** A soft gradient behind the hero (copper on Home, green on a household) adds depth and gives the glass something to refract.

## Key changes by screen

- **Home (iPhone):** the hero amount, one "Follow your money" card, and Recent. The card shows a spent / invested / left bar, opens the money flow screen, and has an Insights button for category detail. There is no separate category row, so Home shows only a few numbers.
- **Navigation (iPhone):** a floating glass tab bar with Home, Activity, Shared, and Trips, plus a separate tinted **+** button that is always available. The "More" tab goes away: Recurring, Accounts, Categories, and Settings move behind the settings button on Home, which opens a sheet.
- **Money flow (Sankey), kept:** "Follow your money" stays as a full screen. On iPhone, the flow card on Home opens it. The diagram fits the phone width without horizontal scrolling. Totals for came in, went out, and left over sit above it. Tapping a band or label highlights that flow, dims the others, and shows a focus card with the share of income and of spending. The data rules match `moneyFlow.ts`: at most five categories plus "N more", Invested and Left over as destinations, "Beyond income" as a source in a deficit month, and only your share of split expenses.
- **Add entry:** a sheet with a large amount and an always-visible decimal keypad, so an expense takes about three taps. A segmented control switches between Expense, Income, and Invest. The three most-used categories appear as chips, and Date, Account, and Split are labeled rows. Receipt, repeat, and trip move under one disclosure row. Save is the glass check button in the sheet's toolbar, as in Apple's own apps.
- **Activity:** entries are grouped by day with a daily net total. Filter chips sit at the top, and search is a glass field at the bottom (the iOS 26 pattern). Edit and Delete are swipe actions, not buttons on each row.
- **Shared:** a household opens with its members and the balance ("you're owed $142.50"), followed by **Record payment** and **Expense** actions. Expenses, Balances, and People are tabs in a segmented control. Each row shows who paid and your share.
- **iPad:** a floating glass sidebar (`NavigationSplitView`). Households and trips appear in the sidebar directly, with their balances. Home becomes a dashboard with the hero, a coming-up recurring panel, the Sankey as the main panel, and daily spending. Activity uses a list plus a detail pane, so there are no modal hops on the large screen.

## Implementation notes (Expo SDK 57)

- Native tabs and sidebar: `expo-router` native tabs give the iOS 26 floating tab bar for free. Check the [SDK 57 router docs](https://docs.expo.dev/versions/v57.0.0/) for the current API before implementing.
- Glass: `expo-glass-effect` (already a dependency) provides the real material. The CSS blur here only approximates it.
- SwiftUI controls: `@expo/ui` (already a dependency) can render the native segmented picker, menus, and the date picker.
- Themes: this proposal defines light and dark, which follow the system setting. AMOLED becomes unnecessary because dark mode already uses a true-black background. Catppuccin could stay as an optional accent color rather than a full palette.
- Remove Android-specific and web-specific layout code paths once iOS is the only target.

## Rendering

The previews use Inter as a stand-in for SF Pro (SF Pro cannot be redistributed) and Ionicons as stand-ins for SF Symbols.

```sh
node docs/design/penny-ios/render.mjs 2   # writes previews/*.png at 2x
```

Set `PENNY_DESIGN_CHROME` if Playwright's Chromium is not installed.
