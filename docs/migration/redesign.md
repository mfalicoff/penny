# Redesign baseline and adaptations

The iOS-native redesign in [`docs/design/penny-ios/`](../design/penny-ios/README.md) is v2's visual and interaction baseline. It has 61 cards for iPhone, iPad, web and system, and the [`design-kit/`](../../design-kit/package.json) component kit (`@penny/ios-kit`, 42 components). Both are synced to the [Penny Claude Design project](https://claude.ai/design/p/173b576e-aa32-44dc-9f83-23f0ea8df538); read [`.design-sync/NOTES.md`](../../.design-sync/NOTES.md) before re-syncing. It replaces the earlier Penpot proposal (`docs/design/penny-redesign/`, removed in #30).

[design-baseline.json](../../contracts/design-baseline.json) (version 2, MAZ-132) records:

- every card, with a stable id (`<folder>-<file>`, for example `iphone-home`), its `@dsCard` group, name and viewport, source path and SHA-256;
- the native and web feature issues for each card, its legacy route and test, and its MAZ-82/96 acceptance scenario;
- the 42 design-kit controls, with their source file, docs page and hash;
- the tokens (`--pk-*` in `design-kit/src/styles.css`), fonts, icons, materials, navigation and legacy route map;
- the decisions below, the behavior issues the design implies, and known gaps.

`tests/core/contracts.test.ts` checks the baseline against the files on disk: the card list, markers and hashes, the kit components and Claude Design source map, the source hashes, and that every Expo Router screen under `src/app/` keeps a destination. After a design change, update the affected entries and hashes in the same change.

## Decisions (MAZ-132)

| Topic | Decision |
| --- | --- |
| Baseline | `docs/design/penny-ios` and `design-kit` replace Penpot. MAZ-122 is rewritten around the new cards and owns the visual comparison of implementations. |
| Appearances | Light and dark only, following the system setting. Dark is true black, so AMOLED is dropped. Catppuccin is dropped, not kept as an accent. A saved legacy `amoled` or `catppuccin` preference migrates to dark (MAZ-72/87). |
| Navigation | iPhone: a floating glass tab bar with Home, Activity, Shared and Trips, plus a separate tinted **+** button. More goes away: Recurring, Accounts, Categories and Settings open from the settings button on Home, as a sheet. iPad: `NavigationSplitView` with a glass sidebar listing households and trips. Web: a persistent sidebar and a top bar with ⌘K search and Add entry. |
| Fonts and icons | iOS: SF Pro with Dynamic Type styles, and SF Symbols. Web: Inter, bundled with its OFL license (`design-kit/fonts/`), and Ionicons v7 outline (MIT, `design-kit/src/icons.ts`). |
| Android | No card. The legacy Android app is retired under MAZ-98 and has no redesign baseline. |

## Legacy deep links

Every legacy route keeps a destination. Details, pickers and confirmations are sheets on iOS and panels or dialogs on the web; don't turn each card into a new public URL.

| Route | iPhone | iPad and web |
| --- | --- | --- |
| `/` | Home tab | Home |
| `/transactions` | Activity tab | Activity |
| `/entries/new` (also the widget **+**) | Add entry sheet | Add entry form sheet or dialog |
| `/accounts`, `/categories`, `/recurring` | Settings sheet › page | Settings › page |
| `/households`, `/households/[id]` | Shared tab, household | Sidebar › Together, household |
| `/households/[id]/expenses/[expenseId]` | household › expense detail | household with the expense in the detail pane |
| `/trips`, `/trips/[id]` | Trips tab, trip | Trips (web) or sidebar (iPad), trip |
| `/auth/callback` | OIDC callback, then Home | OIDC callback, then Home |

## Interaction baseline

| Concern | Required behavior | Owners and acceptance |
| --- | --- | --- |
| Home and analysis | **Left to spend** leads as one hero amount, with Projected directly under it. One Follow your money card opens the money flow (Sankey) and Insights. Income and spending are not an account balance; investments are contributions. | MAZ-77/92, overview and money-flow fixtures |
| Entry and Activity | Add entry is a sheet with a large amount and an always-visible keypad on iPhone (a keyboard form on iPad and web). Expense, Income and Invest are a segmented control; three category chips; labeled Date, Account and Split rows; receipt, repeat and trip under one disclosure row; Save in the toolbar. Activity groups by day with a daily net, filter chips and a bottom search field; edit and delete are swipe actions (row actions on web). | MAZ-73/88, draft, error and duplicate-submit journeys |
| Shared and trips | A household opens with members and your balance, then Record payment and Expense. Expenses, Balances and People are tabs. Recording a payment states that Penny doesn't move money. A stale payment shows the old and new amounts and offers only Review expense. Shared trips keep pre-sharing entries in an Only you section. | MAZ-75/76/91/93, two-user settlement and privacy journeys |
| Organize | Accounts are labels with usage counts and no balances; an account in use can't be removed, and the reason is shown. Recurring rows show cadence and next date, with pause and remove as swipe actions. The category color picker offers only the category palette. | MAZ-74/89/90 |
| Feedback | Each failure keeps the user's work and names the next step: offline banner with pending rows, save error that keeps the draft, sign-out warning about unsynced changes, and confirmation before deleting a shared expense for everyone. Saving shows a toast with Undo. | MAZ-69/71/85/87 |
| Access | Face ID lock conceals content and open sheets while keeping drafts. Signed-out server verification needs no credentials; the server is read-only when signed in. The web uses the current origin and has no lock. | MAZ-68/69/84/85 |
| Color | Copper is the only brand and action tint. Green means income, indigo investments, amber pending or expected, red errors and destructive actions. Expenses use the label color. Category colors never reuse a meaning color, and meaning is always also shown in text or an icon. | MAZ-69/85, all feature visual gates |

Native iOS 26 Liquid Glass is required on the control layer only: the tab bar, toolbars, the month picker, search and floating buttons. Money and lists stay on solid surfaces. SwiftUI uses the real material (`.glassEffect`); the CSS blur in the cards only approximates it. Reduce Transparency uses opaque high-contrast surfaces, and Reduce Motion avoids unnecessary transitions. The native app's minimum is iOS 26.0 (MAZ-66), so every supported device has the real material and no older-OS fallback exists; under Reduce Transparency, custom glass controls draw an opaque surface ([native app](../../apps/ios/README.md#minimum-os-and-liquid-glass)).

## New behavior

The design implies behavior the legacy app doesn't have. Each item is filed and linked from the cards' `behaviorIssues`:

- MAZ-133: a Face ID **Lock after** delay (Immediately, 1 minute, 5 minutes).
- MAZ-134: Add entry category chips ordered by recent use.
- MAZ-135: medium and Lock Screen widgets, and restyled small widgets.
- MAZ-136: income dated after today counts toward Projected, not Left to spend.

## Coverage and limits

Every card has its feature owners and a planned MAZ-82/96 acceptance scenario. Web-shell controls (`WebFrame`, `WebSidebar`, `TopBar`, `DataTable`, `Dialog` and the rest of the Web category) have no native owner; `system-widgets` has no web owner. [redesign-states.json](../../contracts/fixtures/redesign-states.json) gives each card its seeded data state in light and dark ([test environment](test-environment.md#redesign-specimens)).

Adapt the fixed card viewports to safe areas, iPhone landscape, iPad split and multicolumn, and resizable browser windows; validate 320px through desktop rather than copying fixed geometry. Test Dynamic Type and VoiceOver, keyboard and focus, scrolling above Save, contrast on the hero glow, reduced motion and transparency, and native pickers. These are acceptance requirements, not evidence of device execution.

The cards are static HTML rendered with Inter and Ionicons as stand-ins for SF Pro and SF Symbols. No implementation has been visually compared with them yet; MAZ-122 owns that comparison. Larger text, a real keyboard and focus, native pickers, app lock and server-search loading states still need implementation validation, and MAZ-82/96 can't substitute card checks for those gates.

## Native implementation notes (MAZ-69)

The SwiftUI shell, settings, lock and demo are described in [native app shell](../ios-shell.md). Adaptations from the cards:

- **Add entry on iPhone** is a `Tab` with the search role in the system tab bar, so it is real Liquid Glass and follows system accessibility. On the simulator it renders as a fifth item inside the bar, not as the card's separate copper circle; a custom separate button over the system bar is a follow-up for MAZ-122's comparison.
- **iPad** uses the same navigation state in a `NavigationSplitView`; Settings and the Manage pages open in the detail column instead of a sheet. In compact widths (Slide Over, narrow Split View) the iPad uses the iPhone tab bar.
- **Lock after** (Immediately, 1 minute, 5 minutes on `iphone-app-lock`) is MAZ-133 and not in this build; the lock applies immediately, as in the legacy app.
- **The lock screen** shows no amount; the card's blurred hero behind the lock is not drawn, so nothing of the ledger is visible while locked.
- Screens owned by feature issues (Add entry, households, insights, the money flow, the iPad dashboard panels) show a named "not available yet" state, and every legacy route still lands on its destination.
