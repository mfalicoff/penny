# Penny for iOS: native redesign proposal

This proposal targets iPhone and iPad (the SwiftUI app in `apps/ios`) and the desktop web app (`apps/web`). It replaces the warm card-heavy look of both the current Expo app and the earlier Penpot proposal (which this change removes) with a design that feels native to iOS 26.

Each screen is a standalone HTML file with a `@dsCard` marker, so the folder can be imported straight into a Claude Design design-system project. Rendered PNGs are in [previews/](previews/).

| Area | Cards |
| --- | --- |
| System | [foundations](system/foundations.html), [widgets](system/widgets.html) |
| iPhone · daily money | [home](iphone/home.html), [home-dark](iphone/home-dark.html), [money-flow](iphone/money-flow.html), [insights](iphone/insights.html), [calendar](iphone/calendar.html), [activity](iphone/activity.html), [search-empty](iphone/search-empty.html) |
| iPhone · entries | [add-expense](iphone/add-expense.html), [add-income](iphone/add-income.html), [entry-extras](iphone/entry-extras.html), [split](iphone/split.html), [category-picker](iphone/category-picker.html), [entry-detail](iphone/entry-detail.html), [receipt](iphone/receipt.html), [delete-confirm](iphone/delete-confirm.html) |
| iPhone · shared | [shared-list](iphone/shared-list.html), [shared](iphone/shared.html), [shared-balances](iphone/shared-balances.html), [shared-people](iphone/shared-people.html), [shared-expense-add](iphone/shared-expense-add.html), [record-payment](iphone/record-payment.html), [payment-stale](iphone/payment-stale.html), [household-create](iphone/household-create.html), [history](iphone/history.html) |
| iPhone · trips | [trips](iphone/trips.html), [trip-detail](iphone/trip-detail.html), [trip-form](iphone/trip-form.html) |
| iPhone · organize & settings | [settings](iphone/settings.html), [recurring](iphone/recurring.html), [schedule-detail](iphone/schedule-detail.html), [accounts](iphone/accounts.html), [account-form](iphone/account-form.html), [categories](iphone/categories.html), [category-form](iphone/category-form.html), [appearance](iphone/appearance.html), [app-lock](iphone/app-lock.html) |
| iPhone · access & states | [sign-in](iphone/sign-in.html), [create-account](iphone/create-account.html), [server-connect](iphone/server-connect.html), [lock](iphone/lock.html), [empty-home](iphone/empty-home.html), [offline](iphone/offline.html), [save-error](iphone/save-error.html), [saved-toast](iphone/saved-toast.html), [sign-out](iphone/sign-out.html) |
| iPad | [home](ipad/home.html), [activity](ipad/activity.html), [add-entry](ipad/add-entry.html), [shared](ipad/shared.html), [trip](ipad/trip.html), [settings](ipad/settings.html) |
| Web (desktop browser) | [home](web/home.html), [activity](web/activity.html), [insights](web/insights.html), [household](web/household.html), [trips](web/trips.html), [settings](web/settings.html), [add-entry](web/add-entry.html), [sign-in](web/sign-in.html) |

61 cards in total. Sheets that open over another screen (calendar, add income, split, category picker and others) embed that screen in an iframe, so they stay in sync with it.

## Direction

1. **Use the platform, not a theme.** SF Pro with Dynamic Type styles, SF Symbols, large titles, inset-grouped lists, sheets with detents, swipe actions, and the system keyboard. The custom DM Sans and the hand-built pill pickers go away.
2. **Liquid Glass belongs on the control layer only.** The floating tab bar, toolbar buttons, the month picker, and the search field are glass. Money and lists stay on solid surfaces, so they remain readable.
3. **One number leads each screen.** Home opens with **Left to spend** as a 64pt hero. Projected money, including expected pay, sits directly under it. The four equal summary cards are gone.
4. **Color has a job.** Copper (`#E4572E`) is the single brand and action tint. Green means income, indigo means investments, amber means pending or expected, and red is reserved for errors and destructive actions. Expenses use the normal label color, not red. Category colors (blue, teal, slate, pink, brown) never reuse one of these meaning colors, so a color on screen always has one meaning. People appear as gray monograms, like iOS Contacts. Switches use copper, not the iOS default green, because green means income.
5. **Content-tinted glow.** A soft gradient behind the hero (copper on Home, green on a household) adds depth and gives the glass something to refract.

## Key changes by screen

- **Home (iPhone):** the hero amount, one "Follow your money" card, and Recent. The card shows a spent / invested / left bar, opens the money flow screen, and has an Insights button for category detail. There is no separate category row, so Home shows only a few numbers.
- **Navigation (iPhone):** a floating glass tab bar with Home, Activity, Shared, and Trips, plus a separate tinted **+** button that is always available. The "More" tab goes away: Recurring, Accounts, Categories, and Settings move behind the settings button on Home, which opens a sheet.
- **Money flow (Sankey), kept:** "Follow your money" stays as a full screen. On iPhone, the flow card on Home opens it. The diagram fits the phone width without horizontal scrolling. Totals for came in, went out, and left over sit above it. Tapping a band or label highlights that flow, dims the others, and shows a focus card with the share of income and of spending. The data rules match `moneyFlow.ts`: at most five categories plus "N more", Invested and Left over as destinations, "Beyond income" as a source in a deficit month, and only your share of split expenses.
- **Add entry:** a sheet with a large amount and an always-visible decimal keypad, so an expense takes about three taps. A segmented control switches between Expense, Income, and Invest. The three most-used categories appear as chips, and Date, Account, and Split are labeled rows. Receipt, repeat, and trip move under one disclosure row. Save is the glass check button in the sheet's toolbar, as in Apple's own apps.
- **Activity:** entries are grouped by day with a daily net total. Filter chips sit at the top, and search is a glass field at the bottom (the iOS 26 pattern). Edit and Delete are swipe actions, not buttons on each row.
- **Shared:** a household opens with its members and the balance ("you're owed $142.50"), followed by **Record payment** and **Expense** actions. Expenses, Balances, and People are tabs in a segmented control. Each row shows who paid and your share.
- **iPad:** a floating glass sidebar (`NavigationSplitView`). Households and trips appear in the sidebar directly, with their balances. Home becomes a dashboard with the hero, a coming-up recurring panel, the Sankey as the main panel, and daily spending. Activity uses a list plus a detail pane, so there are no modal hops on the large screen. Add entry opens as a centered two-column form sheet and uses the hardware or system keyboard instead of the keypad.
- **Insights and calendar:** Insights shows a category donut, one month-over-month sentence, and the category list. The calendar sheet marks days with dots in the meaning colors only: gray for spent, green for income, indigo for invested, and an amber ring for scheduled.
- **Entry details:** split, receipt/repeat/trip, and the category picker are stacked sheets. A personal split stores only a head count, so it shows "You" and "N other people" without names. An expense dated in the future counts toward Projected, and the Income form explains this, because the app has no separate "expected" field.
- **Shared and trips:**
  - The Shared tab lists households and trips with your net balance in each.
  - Monthly settlement opens on the last day of the month, and overdue months stay actionable.
  - Record payment states that Penny records a payment and doesn't move money.
  - A stale payment shows the old and new amounts and offers only "Review expense".
  - Shared trips keep expenses added before sharing in a separate "Only you" section.
- **Organize:** Settings opens as a sheet and replaces the More tab. Accounts are labels with usage counts and no balances. An account that entries use can't be removed, and the reason is shown. Recurring rows show cadence and next date, and pause and remove are swipe actions. The category color picker offers only the category palette.
- **States:**
  - Each failure keeps the user's work and names the next step: an offline banner with pending rows, a save error that keeps the draft, a sign-out warning about unsynced changes, and a confirmation before deleting a shared expense for everyone.
  - Saving shows a toast with Undo instead of a success screen.
- **Widgets:** both existing small widgets are restyled, and medium and Lock Screen widgets are added. The new sizes need `supportedFamilies` extended in the widget config.

## Web (desktop browser)

The web app uses the same tokens, color rules and money semantics as the iOS app, adapted for a mouse, a keyboard and wide screens:

- **Shell:** a persistent left sidebar (Home, Activity, Insights; Together lists each household and trip; Manage). A top bar holds the page title, the month switcher, a ⌘K search and a copper **Add entry** button (N). Glass is limited to small floating elements over the hero glow; panels are solid.
- **Home:** the Left to spend hero with Came in / Spent / Invested tiles, Coming up, a large Sankey (hover a band to focus), and By category.
- **Activity:** a dense table grouped by day with daily totals, multi-select checkboxes, row actions on hover, and a detail panel on the right instead of a new page. Keyboard: ↑↓, ↵, E, ⌫, X.
- **Insights:** the full-width Sankey with a click-to-focus band, a category table comparing with last month, and a six-month in/spent chart.
- **Household:** an expenses table (paid by, split, total, your share, status) with Balances, Suggested payments and an overdue month beside it. Recording a payment still states that Penny never moves money.
- **Trips:** the next trip as a feature card with its expenses (private "Only you" entries marked), then a grid of other trips and a New trip card.
- **Settings:** a section list and detail panes. Includes Reduce transparency and the read-only server.
- **Add entry:** a centered two-column dialog (amount, name and categories on the left; date, account, split, repeat, trip and a receipt drop zone on the right) with ⌘↵ to save and Esc to cancel.
- **Sign in:** split screen with the brand and a Left to spend preview on the left, and the server chip, email, SSO and Create account on the right.

## Implementation notes (v2)

- **iOS (`apps/ios`, SwiftUI):** use the system `TabView` (iOS 26 floating tab bar plus a separate add action) on iPhone and `NavigationSplitView` on iPad. Use real Liquid Glass (`.glassEffect`) only on toolbars, the tab bar and floating controls; the CSS blur in these cards only approximates it. SF Pro and SF Symbols replace Inter and Ionicons. Use `.sheet` with detents for entry flows, `.swipeActions` for edit and delete, and `.searchable` for search.
- **Web (`apps/web`, React):** `design-kit/` (`@penny/ios-kit`) is a React reference of these components, including the web shell (WebFrame, WebSidebar, TopBar, DataTable, Dialog). Its tokens and `pk-*` classes can be ported directly; the shared money calculations stay in the API.
- **Themes:** light and dark follow the system setting. Dark already uses a true-black background, so AMOLED and Catppuccin are dropped (MAZ-132).
- **Baseline contract:** `contracts/design-baseline.json` traces every card here and every `design-kit` control (MAZ-132). Its tests check the card markers and file hashes, so update the contract in the same change as a card ([redesign baseline](../../migration/redesign.md)).

## Rendering

The previews use Inter as a stand-in for SF Pro (SF Pro cannot be redistributed) and Ionicons as stand-ins for SF Symbols.

```sh
node docs/design/penny-ios/render.mjs 2   # writes previews/*.png at 2x
```

Set `PENNY_DESIGN_CHROME` if Playwright's Chromium is not installed.
