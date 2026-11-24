# Redesign baseline and adaptations

The iOS-native redesign in [`docs/design/penny-ios/`](../design/penny-ios/README.md) is v2's visual and interaction baseline. It has 82 cards for iPhone, iPad, web and system, and the [`design-kit/`](../../design-kit/package.json) component kit (`@penny/ios-kit`, 42 components). Both are synced to the [Penny Claude Design project](https://claude.ai/design/p/173b576e-aa32-44dc-9f83-23f0ea8df538); read [`.design-sync/NOTES.md`](../../.design-sync/NOTES.md) before re-syncing. It replaces the earlier Penpot proposal (`docs/design/penny-redesign/`, removed in #30).

[design-baseline.json](../../contracts/design-baseline.json) (version 2, MAZ-132) records:

- every card, with a stable id (`<folder>-<file>`, for example `iphone-home`), its `@dsCard` group, name and viewport, source path and SHA-256;
- the native and web feature issues for each card, its route, and its MAZ-82/96 acceptance scenario;
- the 42 design-kit controls, with their source file, docs page and hash;
- the tokens (`--pk-*` in `design-kit/src/styles.css`), fonts, icons, materials, navigation and the route map (`navigation.routes`);
- the decisions below, the behavior issues the design implies, and known gaps.

`apps/web/tests/domain/contracts.test.ts` checks the baseline against the files on disk: the card list, markers and hashes, the kit components and Claude Design source map, the source hashes, and that every route in the baseline (`navigation.routes`) keeps a destination on iPhone, iPad and web. After a design change, update the affected entries and hashes in the same change.

## Decisions (MAZ-132)

| Topic | Decision |
| --- | --- |
| Baseline | `docs/design/penny-ios` and `design-kit` replace Penpot. MAZ-122 renders the cards as light and dark baselines and records each card's comparison with both apps ([visual acceptance](../design/visual-acceptance.md)). |
| Appearances | Light and dark only, following the system setting. Dark is true black, so AMOLED is dropped. Catppuccin is dropped, not kept as an accent. |
| Navigation | iPhone: a floating glass tab bar with Home, Activity, Shared and Trips, plus a separate tinted **+** button. More goes away: Recurring, Accounts, Categories and Settings open from the settings button on Home, as a sheet. iPad: `NavigationSplitView` with a glass sidebar listing households and trips. Web: a persistent sidebar and a top bar with ⌘K search and Add entry. |
| Fonts and icons | iOS: SF Pro with Dynamic Type styles, and SF Symbols. Web: Inter, bundled with its OFL license (`design-kit/fonts/`), and Ionicons v7 outline (MIT, `design-kit/src/icons.ts`). |
| Android | No card. There is no Android app (retired in MAZ-98). |

## Routes and deep links

Each route is a web URL and, as `penny://<route>`, an iOS deep link (the widget, notifications and the OIDC callback use them). Every route keeps a destination. Details, pickers and confirmations are sheets on iOS and panels or dialogs on the web; don't turn each card into a new public URL.

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
| Entry and Activity | Add entry is a sheet with a large amount and an always-visible keypad on iPhone (a keyboard form on iPad; on the web, a dialog with keyboard entry, see [Web conventions](#web-conventions-maz-227)). Expense, Income and Invest are a segmented control; three category chips; labeled Date, Account and Split rows; receipt, repeat and trip under one disclosure row; Save in the toolbar. Activity groups by day with a daily net, filter chips and a bottom search field; edit and delete are swipe actions (on the web, a row opens the entry dialog; see [Web conventions](#web-conventions-maz-227)). | MAZ-73/88, draft, error and duplicate-submit journeys |
| Shared and trips | A household opens with members and your balance, then Record payment and Expense. Expenses, Balances and People are tabs. Recording a payment states that Penny doesn't move money. A stale payment shows the old and new amounts and offers only Review expense. Shared trips keep pre-sharing entries in an Only you section. | MAZ-75/76/91/93, two-user settlement and privacy journeys |
| Organize | Accounts are labels with usage counts and no balances; an account in use can't be removed, and the reason is shown. Recurring rows show cadence and next date, with pause and remove as swipe actions (on the web, a row opens the schedule dialog). The category color picker offers only the category palette. | MAZ-74/89/90 |
| Feedback | Each failure keeps the user's work and names the next step: offline banner with pending rows, save error that keeps the draft, sign-out warning about unsynced changes, and confirmation before deleting a shared expense for everyone. Saving shows a toast with Undo. | MAZ-69/71/85/87 |
| Access | Face ID lock conceals content and open sheets while keeping drafts. Signed-out server verification needs no credentials; the server is read-only when signed in. The web uses the current origin and has no lock. | MAZ-68/69/84/85 |
| Color | Copper is the only brand and action tint. Green means income, indigo investments, amber pending or expected, red errors and destructive actions. Expenses use the label color. Category colors never reuse a meaning color, and meaning is always also shown in text or an icon. | MAZ-69/85, all feature visual gates |

Native iOS 26 Liquid Glass is required on the control layer only: the tab bar, toolbars, the month picker, search and floating buttons. Money and lists stay on solid surfaces. SwiftUI uses the real material (`.glassEffect`); the CSS blur in the cards only approximates it. Reduce Transparency uses opaque high-contrast surfaces, and Reduce Motion avoids unnecessary transitions. The native app's minimum is iOS 26.0 (MAZ-66), so every supported device has the real material and no older-OS fallback exists; under Reduce Transparency, custom glass controls draw an opaque surface ([native app](../../apps/ios/README.md#minimum-os-and-liquid-glass)).

## New behavior

The design implies new behavior. Each item is filed and linked from the cards' `behaviorIssues`:

- MAZ-133: a Face ID **Lock after** delay (Immediately, 1 minute, 5 minutes).
- MAZ-134: Add entry category chips ordered by recent use.
- MAZ-135: medium and Lock Screen widgets, and restyled small widgets.
- MAZ-136: income dated after today counts toward Projected, not Left to spend.

## Coverage and limits

Every card has its feature owners and a planned MAZ-82/96 acceptance scenario. Web-shell controls (`WebFrame`, `WebSidebar`, `TopBar`, `DataTable`, `Dialog` and the rest of the Web category) have no native owner; `system-widgets` has no web owner. [redesign-states.json](../../contracts/fixtures/redesign-states.json) gives each card its seeded data state in light and dark ([test environment](test-environment.md#redesign-specimens)).

Adapt the fixed card viewports to safe areas, iPhone landscape, iPad split and multicolumn, and resizable browser windows; validate 320px through desktop rather than copying fixed geometry. Test Dynamic Type and VoiceOver, keyboard and focus, scrolling above Save, contrast on the hero glow, reduced motion and transparency, and native pickers. These are acceptance requirements, not evidence of device execution.

The cards are static HTML rendered with Inter and Ionicons as stand-ins for SF Pro and SF Symbols. MAZ-122 compared both apps with every card: the light and dark baselines, captures and verdicts are described in [visual acceptance](../design/visual-acceptance.md), and the verdicts are in [visual-comparisons.json](../../contracts/visual-comparisons.json). The approved deviations are [below](#approved-deviations-maz-122). Larger text, a real keyboard and focus, native pickers, app lock and server-search loading states still need implementation validation, and MAZ-82/96 can't substitute card checks for those gates.

## Native implementation notes (MAZ-69)

The SwiftUI shell, settings, lock and demo are described in [native app shell](../ios/shell.md). Adaptations from the cards:

- **iPad** uses the same navigation state in a `NavigationSplitView`; Settings and the Manage pages open in the detail column, beside the sidebar, as `ipad-settings` draws them (checked in MAZ-257). In compact widths (Slide Over, narrow Split View) the iPad uses the iPhone tab bar.
- **Lock after** (Immediately, 1 minute, 5 minutes on `iphone-app-lock`) is MAZ-133 and not in this build; the lock applies immediately.
- **The lock screen** shows no amount; the card's blurred hero behind the lock is not drawn, so nothing of the ledger is visible while locked.
- Screens owned by feature issues (households and other later work) show a named "not available yet" state, and every route still lands on its destination. Home, Insights, the money flow, the calendar and the iPad dashboard panels arrived with MAZ-77 (below). On the web, Home, Insights and the money flow arrived with MAZ-92.

## Native overview notes (MAZ-77)

The SwiftUI app builds `iphone-home`, `iphone-home-dark`, `iphone-empty-home`, `iphone-money-flow`, `iphone-insights`, `iphone-calendar` and `ipad-home` ([native overview](../ios/overview.md)). Adaptations from the cards:

- **Home** follows the cards since MAZ-254: the Follow your money card opens the money flow and its Insights pill opens Insights; the calendar is a sheet over Home from the toolbar; on iPhone, Expected income and Explore your month (Calendar, Spending by category, Money flow) follow `iphone-home-explore`, and the iPad dashboard has neither Explore nor Recent, as on `ipad-home`.
- **The money flow is recorded-only**, like Left to spend. The value list behind Show as a table, under the focus hint, is its accessible alternative, as on the cards since MAZ-224; at accessibility text sizes it replaces the chart, shown open.
- **iPad** uses the dashboard only in a regular width of at least 760 points; narrower, it uses the iPhone layout. In portrait the sidebar starts hidden and the dashboard stacks as on `ipad-home-portrait`.

## Web recurring notes (MAZ-90)

The web builds `iphone-recurring` and `iphone-schedule-detail` from the MAZ-85 components ([web README](../../apps/web/README.md#recurring-schedules-maz-90)). Adaptations from the cards:

- **No swipe actions.** A row opens the schedule detail (a dialog, not a new URL); Pause/Resume and Remove are buttons there, and removal has its own confirmation. The page footer says what editing and removing do instead of "Swipe a schedule".
- **New schedule** is the toolbar + (MAZ-232), as on the card, and opens a dialog with the whole form; the cards have no web form, so it follows the entry form's fields with a live line for the next dates and catch-up.
- Rows add **Waiting to sync** while the change is only on this device.
- **Shared schedules (MAZ-177).** The web lists every shared schedule you're part of among the expenses, marked with a **Shared** badge, the household's name in place of the account, and your share of the next occurrence labelled "your share", so a shared total is never read as yours. A shared row opens its household, where it's edited, and the page footer says so. Since MAZ-219 the card shows a shared Streaming row too; since MAZ-232 the web row matches it: the Shared tag beside the title, the category tile, the household's name on its own line and "your share" under the amount.

## Web shared-household notes (MAZ-91)

The web builds the Shared cards (`iphone-shared-list`, `iphone-shared`, `iphone-shared-balances`, `iphone-shared-people`, `iphone-shared-expense-add`, `iphone-split`, `iphone-record-payment`, `iphone-payment-stale`, `iphone-household-create`, `iphone-history`, `ipad-shared`, `web-household`) from the MAZ-85 components ([web README](../../apps/web/README.md#shared-households-maz-91)). Adaptations from the cards:

- **Navigation bar (MAZ-229).** As on the cards, History (clock) and Invite (person) are navigation-bar icons beside the month control, with Back to Shared before the title. Below 1100px the hero keeps Record payment and Shared expense, as on `iphone-shared`; from 1100px Shared expense joins the navigation bar, as in the `web-household` header, and the top bar's search and Add entry step aside. Balances, People and History drop the hero, as the cards collapse to a navigation bar. A shared trip has Invite and a … menu (Edit trip, History, and Trip expense below 1100px; the copper Trip expense button from there), as on `iphone-trip-detail` and `ipad-trip`.
- **Two panes from 1100px (MAZ-229).** As on `ipad-shared` and `web-household`, Expenses lists the expenses on the left, and the selected expense and Balances on the right; the expense URL (`/households/$id/expenses/$expenseId`) selects it. On a touch tablet the hero splits across the panes, as on `ipad-shared`: the name, the members and the month's total ("November · $X in shared expenses") over the expenses, grouped under This week (the last seven days) and Earlier, and the viewer's balance over Balances and the selected expense. The bar's add action reads + Expense, and its title is for screen readers. The pane always shows an expense, as `ipad-activity` always shows an entry: the first listed one, and again when the selected one is deleted or another month is chosen (an expense opened from Activity or Home stays open, even from another month). Its Balances card is the card's: each member's payment on their row ("pays you $110.40"), gets back or owes under the amount, Record paid on the row once the month's payments open, and the hint before then. The desktop keeps `web-household`'s Suggested payments. The selected expense there is the card's short card: its title with "Jo paid $184.20 · Nov 4", then each member's share with Paid or Mark as paid; Edit, Change history, Repeating expense and Delete are in its … menu. `web-household` and the phone dialog keep the full expense. Narrower windows open the expense as a dialog over the household and keep Balances as its own section, down to 320px.
- **Repeating expenses and removal (MAZ-229).** The cards draw no Repeating card and no Remove on member rows. A repeating expense opens from an expense it added (Repeating expense) or from Recurring (`?rule=`), with Edit, Pause or Resume, and Stop repeating. Removing someone is under People › Manage.
- **Payment changed** keeps the card's content (old and new values, who changed it and when, Review expense, "Nothing was recorded") inside the expense dialog. It names the real cause (MAZ-176): when another payment made the copy stale, often the same person on another device, it says who recorded it instead of describing an edit, and the Before and Now table lists only the values that changed (total, share, the share's repaid status). A stale monthly payment shows the same comparison for the suggestion.
- **Balance colors (MAZ-176).** Record payment opens Balances, where suggested payments are recorded. The balance uses its meaning color from the design baseline (`colors.meaning`): owed to you is income green, owing is an expense in the label color (never red), settled is muted, and the words ("you're owed", "you owe", "you're settled") say the same.
- The household list's per-row balance reads each household's current month (one detail and one month request per household); the page header and Balances use the same cache.

## Approved deviations (MAZ-122)

MAZ-122 compared the iOS and web apps with every card ([visual acceptance](../design/visual-acceptance.md), [verdicts](../../contracts/visual-comparisons.json)). A deviation is approved only when a human approves it: a person applies the `design-approved` label to its issue and records the decision here. Agents don't add, widen or reword entries in this section ([dev worker, design cards](../development/agents/dev-worker.md#design-cards)). Entries added by agents before 2026-11-19 are being re-checked by MAZ-215 (web) and MAZ-216 (iOS): each one either keeps a human's approval or becomes a follow-up. Each card's verdict links the section that approves it: [Interaction baseline](#interaction-baseline), the MAZ-69, MAZ-77, MAZ-90 and MAZ-91 notes above, or the three lists below. Every other difference is a follow-up, filed against its feature area and linked from the verdict.

Expected differences that need no entry: SF Pro and SF Symbols on iOS, Inter and Ionicons on the web; real Liquid Glass on iOS and a CSS blur on the web; seeded names, amounts and dates instead of the cards' sample data; and platform chrome (status bar, keyboard, system sheets and pickers, the browser window).

### Native adaptations (MAZ-122)

- **Local-first saving (MAZ-257, decided by the owner 2026-11-20, as on the web in MAZ-237).** A save is kept on the device first, so a failed upload is a failed sync: the amber **Couldn't sync · N changes waiting** banner with Retry and an amber **Waiting to sync** row, not the red **Couldn't save** with **Try again** in the form (`iphone-save-error`). The saved toast appears on the local save, before the upload (`iphone-saved-toast`).
- **Names are emails.** Members carry only an email, so households show emails and initials from the email, as on the web.
- **Invite code on request (MAZ-256, decided by the owner 2026-11-20).** Under People, the creator's invite card shows **Create invite code** until asked, instead of the code `iphone-shared-people` draws, because a new code replaces the one already shared: opening People never makes one. Once asked, it shows the code with its countdown, Copy and Share, as on the card.
- **Recurring, Accounts and Shared subtitle spacing (MAZ-236, decided by the owner 2026-11-19; Accounts in MAZ-257, 2026-11-22; the Shared tab in MAZ-172, 2026-11-24).** Recurring, Accounts and the Shared tab keep the system large title instead of redrawing it, so the subtitle ("Penny records these on their date." on Recurring, "Labels for how you pay and get paid." on Accounts, "Split costs with a household or a trip." on Shared) sits about 20 points lower than on `iphone-recurring`, `iphone-accounts` and `iphone-unverified`: the list starts below the system's large-title area, the same system gap on all three.
- **Home's calendar and settings buttons (MAZ-254, decided by the owner 2026-11-20).** On iPhone, Home's calendar and settings are two buttons in the toolbar's trailing group, which iOS draws as one grouped Liquid Glass capsule, not the cards' two separate circles. This is the system's own toolbar grouping; Penny draws no capsule of its own.

### Web conventions (MAZ-227)

The owner approved these web patterns on 2026-11-19 ([MAZ-227](https://linear.app/mfalicoff/issue/MAZ-227)). They apply to every web card that the iOS cards show as a sheet, a pushed screen or swipe actions.

- **Dialogs, not sheets or pushed screens.** Add entry and every other form (shared expense, household, trip, account, category) is a dialog with a title, labelled fields and a Cancel/Save footer, instead of a sheet with close and a copper check in the header. More details and Split expand inside the form instead of a pushed sheet; Split adds Discard draft and Keep draft. Entry detail, schedule detail, record payment and delete are centered dialogs, not pushed screens or a bottom sheet; in the schedule dialog, Remove is a small tinted button.
- **Keyboard entry.** Amounts are typed with the keyboard; there is no keypad at any width.
- **Click to open, not swipe.** Activity and Recurring rows have no swipe actions: a row opens its dialog, where it is edited, paused or removed. Recurring's footer reads "Open a schedule to edit, pause or remove it…" instead of "Swipe a schedule…".
- **Appearance in Settings.** Appearance is a Settings pane with an All settings link, not a pushed page.

### Web adaptations (MAZ-122)

- **Activity and the entry form (MAZ-175).** Activity groups the list by day with each day's net at every width. Below 768px it follows `iphone-activity`: Type and the period lead, then the day-grouped list; search, the period's totals and the category and day filters follow the list as a section of the page rather than a floating bottom search field and a filter sheet, so nothing floats over the rows above the tab bar (`/` and ⌘K still focus search). Active filters are those controls, not removable chips, and when nothing matches the empty state, centered in the results area, offers Search all time (Activity's period is All time, a month or a year) and Clear filters. The Income form says up front, under the type, that pay dated after today counts toward Projected, not Left to spend; a dated callout follows once the date is after today. The category picker is a dialog over Add entry with Most used and every other category as tiles and a New tile, and no Edit categories link, so the draft stays in place (categories are managed from Manage › Categories).
- **Sign-in and sync (MAZ-237, decided by the owner 2026-11-19 in MAZ-234).** Sign in and Create account have no server chip: the web always uses the server it was opened from. The SSO button names the server's configured provider (for example "Continue with Single sign-on") instead of the cards' "SSO", on Create account too. The entry is saved in the browser first, so a failed save is a failed sync: Home shows the amber "Not synced · 1 change waiting" banner with Retry, and the cards' red "Couldn't save" in the form doesn't apply (`iphone-save-error`).
- **Households and shared trips: sections and invite (MAZ-229, decided by the owner 2026-11-19).** Expenses, Balances and People are links styled as the segmented control, each with its own URL (`?tab=`) so Back works, and History is a panel of the household (`?tab=history`), not its own screen. Invite shows the code with a live countdown and Copy, instead of a share sheet.
- **Settings, Appearance, the demo note and the saved toast (MAZ-239, decided by the owner 2026-11-21 from the MAZ-231, MAZ-234 and MAZ-237 follow-ups).** Settings has no Face ID lock row, because the web has no app lock (`iphone-settings`, `ipad-settings`). Appearance has no Text size row, because text follows the browser's size and zoom (`iphone-appearance`, `ipad-settings`), and its theme footnote says "System follows your device's Light and Dark setting…" instead of "your iPhone's" or "your iPad's", because a browser can run on any device. For the same reason, the Reduce transparency row says "Your device's own setting also applies" instead of "Your iPhone's" or "Your iPad's" (`iphone-appearance`, `ipad-settings`; decided by the owner 2026-11-21 from the MAZ-239 follow-up). At phone width, sign-in keeps the note "Sample data in this tab only. Nothing is saved or sent to your server." under the demo link, which `iphone-sign-in` doesn't show, so people on the web know the demo saves nothing. At phone width, the saved toast takes the tab bar's place while it shows, instead of sitting above it as `iphone-saved-toast` draws it: since MAZ-166 a web toast never covers list rows or moves the page.
- **Phone search keeps the tab bar (MAZ-273, decided by the owner 2026-11-20).** At phone width, Activity's bottom "Search activity" field sits above the tab bar instead of replacing it with a Back button, as `iphone-activity` and `iphone-search-empty` draw it on iOS: the web's phone shell keeps its tab bar on every tab, and hiding it on one tab would break navigation.
- **Sign-out (MAZ-178).** The confirmation is a dialog over Settings. With changes waiting it has the card's title, warning and three choices (Sync, then sign out; Sign out anyway; Cancel); with none it is the plain confirmation. The web names the host it was opened from.
- **Picture crop with a mouse (MAZ-171, decided by the owner 2026-11-23).** The "Move and scale" crop (`iphone-profile-photo`) says "Scroll to zoom, drag to move" when the pointer is a mouse, because a mouse can't pinch; touch screens show the card's "Pinch to zoom, drag to move". Keyboard users move with the arrow keys and zoom with + and −, as the crop area describes.
- **No demo on the empty Home (MAZ-204, decided by the owner 2026-11-24).** The web's empty Home has no "Try with sample data" card, which `iphone-empty-home` and the iOS app show: the web demo starts only from sign-in, so sample data never mixes with an account's cached data.
