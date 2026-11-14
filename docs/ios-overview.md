# Native Home, money flow, Insights and calendar (MAZ-77)

[Native app](../apps/ios/README.md) · [Native ledger rules](ios-ledger-domain.md) · [Native app shell](ios-shell.md) · [Redesign baseline](reference/redesign.md) · [Domain rules](reference/domain-rules.md)

This page describes how the SwiftUI app shows a month: Home, the money flow, Insights (spending by category), the calendar and a category's entries. It covers the formulas, how shared and private money is combined, what investments mean here, chart accessibility, the iPhone and iPad layouts, and how performance was checked.

| Piece | Where |
| --- | --- |
| Month totals (recorded, projected, expected income, scheduled) | `PennyDomain` `LedgerReport.month` (MAZ-70/139, [ledger rules](ios-ledger-domain.md#reports)) |
| Money flow, Sankey layout, calendar grid, category breakdown, month comparison, percentages | `PennyDomain/Ledger/Overview.swift` |
| The household projection (the viewer's shares) | `PennyData/Shared/SharedProjection.swift`, `APIClient.householdProjection(month:)` |
| Home, the iPad dashboard, Explore your month | `PennyUI/Home/HomeView.swift` |
| Money flow page and Sankey | `PennyUI/Home/MoneyFlowView.swift` |
| Insights and a category's entries | `PennyUI/Home/InsightsView.swift` |
| Calendar | `PennyUI/Home/CalendarView.swift` |
| Spoken text, colors, identifiers | `PennyUI/Home/OverviewSupport.swift` |
| Xcode previews of the specimens | `PennyUI/Home/OverviewSpecimens.swift` |

## One source of totals

Every number on these screens comes from `LedgerReport.month(_:)`. The overview types (`MoneyFlow`, `CalendarMonth`, `CategoryBreakdown`, `MonthComparison`) only regroup what that summary already decided; they never decide what is recorded, what is projected or what a shared row is worth. A change to those rules in `LedgerReport` (for example MAZ-136, which moves income dated after today into Projected) flows into Home, the flow, Insights and the calendar without changes here. The domain tests assert that every overview adds up to the summary's `recorded` totals, so a rule change that left them out of step would fail there.

## Report formulas

All amounts are integer cents of the ledger currency and use `share` (your part), never `total` (the receipt amount).

| Figure | Formula | Shown as |
| --- | --- | --- |
| Recorded income, spending, contributions | Sum of `share` over the month's recorded entries (personal and shared), by kind, without income dated after today (MAZ-136). Activity's month totals are the same numbers | Income · Spent · your share · Invested |
| **Left to spend** | recorded income − recorded spending − recorded contributions (signed) | Home's hero |
| **Projected** | Left to spend + income dated after today + every scheduled occurrence of the month not recorded yet (income added; expenses and contributions subtracted), personal and shared | The line under the hero: "$X projected" |
| Expected income | Scheduled income plus income dated after today, in the month | "with expected pay", the Expected income card, "Expected" rows in Coming up and in lists |
| Money flow `income`, `expense`, `investment` | The recorded totals above | Came in, Went out = expense + investment |
| Money flow `remaining` | max(0, Left to spend) | Left over |
| Money flow `gap` | max(0, −Left to spend) | Beyond income (a source), "Over" on Home |
| Flow column height | max(income, expense + investment) | Both columns add up to it |
| Share of income | row ÷ recorded income, rounded half up to a whole percent; "<1%" when it rounds to 0 but isn't 0 | Focus card, row labels |
| Share of spending | expense row ÷ recorded spending (only for expense rows and "N more") | Focus card, Insights |
| Category breakdown | Recorded expenses by category, largest first (ties keep category order); total = recorded spending | Insights |
| Month comparison | This month's recorded spending − last month's | "$412 less than October" |
| Calendar day | Recorded spent, received and invested on the day; net = received − spent − invested; scheduled occurrences and income dated after today counted apart | Dots, the amber ring, the day header, "N expected or scheduled" |
| Daily average (iPad) | Recorded spending ÷ days elapsed (through today in the current month, the whole month for a past month; none for a future month), integer cents | "Avg $62.78" |

Money flow rows: at most five per column (`MoneyFlow.maxRows`). With more categories the four largest stay and the rest become one "N more" row holding every cent; the value list under the chart lists the categories inside it. This follows the redesign card ("2 more") and `design-kit` `MoneyFlow`.

### Recorded and projected stay apart

- Left to spend, the money flow, Insights, Recent and Activity's totals use **recorded** entries only. A scheduled preview or expected income is never drawn as money that came in or went out, and never appears in Recent. Activity lists income dated after today (it is a ledger entry) and marks it "Expected", but leaves it out of "Came in"; the totals line names it apart ("$600.00 expected") and its spoken label says it is not counted yet.
- Projected is a separate line with its own spoken label ("Projected remaining, … includes $2,250.00 expected income not received yet"). The Expected income card names each expected payment and says it is "Counted in Projected, not in Left to spend, until it's recorded".
- The calendar marks scheduled occurrences and income dated after today with an amber ring, never a filled dot. The legend says "Expected or scheduled", and a day with any says "N expected or scheduled, not in Left to spend yet" (the same words on screen and for VoiceOver, `OverviewText.calendarPending`).
- Every entry row (`EntryRow`) says its status once, after the date: "Expected" for income dated after today and for scheduled income, "Scheduled" for any other preview, nothing for a recorded entry; the category name stays when there is no account or split. While a change waits to sync, "Waiting to sync" replaces that line and keeps the status ("Waiting to sync · Expected"), so the meaning is never the amber color alone. Previews don't open an entry.
- `ShellModel.today` follows the device: it is read again on every calendar day change (midnight, a clock or time zone change; `CalendarDayMonitoring`, the signal `LedgerSyncModel` materializes recurrence on) and when the app returns to the foreground. Income dated on the new day moves from Expected to Left to spend without a relaunch. The month on screen does not change.
- Expected income is not part of the money flow: the flow matches Left to spend, so the two never disagree.

## Shared and private money

The personal ledger stays on the device; household expenses are server-owned. Home reads `GET /api/households/projection?month=YYYY-MM` for the month on screen and the month before (Insights compares the two). The server answers with **the viewer's share** of each recorded shared expense and of each preview of a shared rule; the app never splits a shared total itself.

`ShellModel.report(_:)` joins the ledger with every answer received this session (`SharedProjectionModel.shares`, oldest month first) in `LedgerReport(ledger:shared:sharedScheduled:)`, which counts each row exactly once:

- a row repeated across answers (the same household and id) appears once, with its newest values;
- a recorded shared occurrence replaces its preview (same household, rule and date);
- a row in another currency than the ledger, or with amounts outside the stored bounds, is left out;
- personal trip expenses are personal ledger entries; a shared trip's expenses arrive as household rows. Neither is copied into the other, so a trip expense is counted once, at your share.

Category totals use the household category (matched by name, icon and color) next to personal categories.

When the projection can't be read (offline, a server error, an expired session), the last answer for that month is kept and Home shows "Shared expenses may be missing" with the next step; a server without households (404) simply has no shared rows. The demo never asks for a projection. The report is cached by ledger and answer revision, so a large ledger is joined once per change, not once per view update.

## What investments mean here

An investment entry is a **contribution**: money moved into savings or a portfolio this month. It is subtracted from Left to spend like spending, but it is not spending: it has its own "Invested" destination in the flow, its own indigo dot in the calendar, and it never appears in Insights' categories or in "share of spending" (its focus card says "a contribution, not spending"). Penny has no account balances and no portfolio values or returns: Income, Spent and Invested are flows within the month, and payment accounts are labels.

## Screens and layouts

**Home (iPhone and compact widths)**: Left to spend, Projected, the Expected income card (when income is expected), the compact Follow your money card (a spent/invested/left bar and three numbers; it opens the money flow), Recent (the five newest recorded entries; "See all" opens Activity), and **Explore your month** with Calendar, Spending by category and Money flow, each with a one-line preview. The empty Home (`empty-home`) shows $0, Add entry and the demo; a month with nothing recorded shows the same layout with zeros and "Nothing recorded this month yet".

**Home (iPad, regular width at least 760 points wide)**: the `ipad-home` card, adapted from the `desktop` reference: the hero with Income, Spent · your share and Invested, Coming up (everything Projected adds to Left to spend, soonest first: income dated after today and the month's scheduled occurrences, each marked "Expected" or "Scheduled"; the iPad counterpart of the Expected income card. A preview dated before today, not materialized yet, still counts in Projected, so it is listed too; past six rows a line names how many more and their net, so the panel never hides money Projected counts), the full interactive money flow ("Tap a band to focus", with Details), Daily spending (a bar per day and the average), Explore your month and Recent. Narrower regular widths (Split View) and accessibility text sizes use the iPhone layout. The desktop card's sidebar Insights row is not added: Insights is a page of Home on every device, reached from Explore your month.

**Money flow**: totals (Came in, Went out, Left over or Beyond income), the Sankey, the focus card for the selected row, and every value as a list (Came in, Went out, the categories inside "N more"). Tapping a band, a label or a list row focuses it and dims the others; tapping it again or × clears the focus. A footnote states that only recorded entries and your share are included.

**Insights**: the donut with the month's spending in the middle, the comparison sentence, two bars for this month and last, and the categories with amount, percentage and a bar. A row opens the category's entries for the month (recorded and scheduled), with its total and share of the month's spending.

**Calendar**: previous/next month (through the current month), Today, the month's recorded totals, a Monday-first grid with meaning dots and the scheduled ring, the legend, and the chosen day's net and entries. Choosing a day filters the list only: the month's totals line above the grid and every Home figure stay the same. The calendar, Insights and the money flow follow the shell's month, so the month picker on each page and the calendar's arrows change the month everywhere.

Navigation: these pages are `DetailRoute.moneyFlow`, `.insights`, `.calendar` and `.categorySpending` in the Home stack (the detail column on iPad), so Back returns to Home. They have no deep links; the redesign's calendar sheet is a page here, which keeps the same month navigation on iPhone and iPad.

### Specimens

| MAZ-77 specimen (Penpot names) | Card in `contracts/design-baseline.json` | Native |
| --- | --- | --- |
| home | `iphone-home` | `HomeView` |
| home-dark | `iphone-home-dark` | `HomeView` in dark |
| home-amoled, home-catppuccin | none: dropped by MAZ-132 | `iphone-home-dark` (dark is true black; there are no other appearances) |
| insights | `iphone-insights` | `InsightsView` |
| calendar | `iphone-calendar` | `CalendarView` |
| money-flow | `iphone-money-flow` | `MoneyFlowView` |
| desktop | `ipad-home` (and `web-home` on the web) | `HomeDashboard` |
| empty-home | `iphone-empty-home` | `EmptyHomeContent` |

`docs/design/penny-redesign/screen-inventory.json` and the Penpot proposal named in the issue were removed in #30 and replaced by `docs/design/penny-ios` (MAZ-132); the cards above are their successors. MAZ-122's finalized handoff is not in the repository yet, so these screens follow the cards and `docs/reference/redesign.md`; MAZ-122 owns the visual comparison.

## Chart accessibility

Color is never the only cue: every amount is also in text, the calendar has a legend and spoken day labels, and category colors never reuse a meaning color.

- **Home's flow card** is one button: "Follow your money", value "Came in $…, spent $…, invested $…, $… left over.", hint "Shows where your money went".
- **Sankey**: the drawing is hidden from VoiceOver. Each label is a button: "Home, $1,450.00 went out, 45% of income · 77% of spending", with the Selected trait when focused and a hint to focus or clear. The chart also provides an Audio Graph (`accessibilityChartDescriptor`: one bar per row, amounts in the ledger currency, the flow summary as its summary).
- **The value list** under the chart repeats every row with its shares and the categories inside "N more"; at accessibility text sizes it replaces the chart, which can't fit readable labels.
- **Donut and daily spending** use Swift Charts with a label and value per mark (category, amount and share; day and amount), so they work with VoiceOver and Audio Graphs. The donut's center total and the comparison bars have text equivalents.
- **Calendar**: each day is a button read as "Friday, November 6, spent $62.00, invested $200.00, 1 expected or scheduled, not in Left to spend yet", with the Selected trait. At accessibility text sizes the grid becomes a list of the days that have entries.
- **Dynamic Type**: text uses system styles; names wrap rather than truncate (`fixedSize(horizontal: false, vertical: true)`), amounts never wrap and shrink only in the Sankey labels (to 75%) and the hero. Totals rows switch from a row to a column when they don't fit (`ViewThatFits`). Touch targets are at least 44 points and scale with text.
- **Reduce Motion** turns off the focus animation. The Liquid Glass Today button falls back to an opaque surface with Reduce Transparency (`pennyGlass`).

Identifiers (`AccessibilityID.Overview`, `AccessibilityID.Home`) follow the convention: `screen.moneyFlow`, `screen.insights`, `screen.calendar`, `screen.categorySpending`, `home.projected`, `home.expectedIncome`, `home.explore*`, `moneyFlow.node.<id>` and `moneyFlow.row.<id>` (a flow id with `:` written as `-`, e.g. `moneyFlow.node.expense-home`), `insights.category.<id>`, `calendar.legend`, `calendar.day.YYYY-MM-DD`.

## Tests

| Test | What it checks |
| --- | --- |
| `PennyDomainTests/OverviewTests` | Totals against `redesign-states.json` `alex-2026-10` built from the `searchable-household` seed (flow, calendar days and scheduled rings, breakdown); shared rows repeated across answers counted once at the share; empty, overspent and income-only months; "N more"; scheduled income never recorded; investments as contributions; long labels kept whole; layout geometry; Monday-first grid; month comparison and category filtering; percentages; a 100,000-entry ledger |
| `PennyDataTests/SharedProjectionTests` | The projection request, mapping to shares, keeping the last answer on failure, 404 as no households, unreadable rows left out, no requests in the demo |
| `PennyUIModuleTests/OverviewViewTests` | The shell's report includes the projection once and is cached; the demo never asks; choosing a day filters without changing totals; VoiceOver sentences; expected income kept out of Left to spend and Recent; Coming up listing expected income and overdue previews so it adds up to Projected; the calendar's "expected or scheduled" wording; the empty-Home rule and Explore previews. (Offscreen `ImageRenderer` checks of these screens were tried and dropped: SwiftUI traps on the simulator when a view updates state during an offscreen render, so layouts are checked by the UI journeys and the Screenshots plan instead.) |
| `PennyUITests/Overview/OverviewJourneyTests` (Full plan; demo, no server) | Home's order and spoken values, the flow's focus and clear, a chosen day keeping the month totals, the calendar legend naming the amber ring "expected or scheduled", Insights to a category, the value list replacing the chart at the largest text size, on iPhone and iPad |
| `ScreenshotTests.test_whenCapturingTheOverview…` (Screenshots plan) | Home, money flow, Insights and calendar in light and dark at the default and accessibility XL sizes on iPhone and iPad, for visual review |

## Performance verification

- `OverviewTests.whenTheLedgerHasAHundredThousandEntries…` builds a ledger at `Ledger.maxEntries` (100,000 entries over eleven months) and measures joining it, summarizing a month and building the flow, calendar, breakdown and comparison. On an M-series Mac (Debug, `ios.sh package-test`) it takes about 0.2 s, and the totals are checked exactly. The test fails above 10 s so a busy CI host doesn't flake.
- Views don't rebuild the report on every update: `ShellModel.report(_:)` reuses it while the ledger (compared by value; unchanged arrays share storage) and the projection revision are the same.
- Lists are lazy (`LazyVStack` in Recent and a category's entries), the calendar grid has at most 42 cells, the Sankey at most ten rows, and the donut at most one mark per category.
- Not measured: scrolling frame rates on a device with Instruments. Do that before release with a 100,000-entry ledger imported into a Debug build.

## Limitations

- Activity still lists the personal ledger only; Home's Recent includes recorded shared rows.
- Shared answers are kept in memory for the session, not on disk, so offline after a relaunch Home shows personal totals with the "may be missing" note until the projection loads.
- The calendar navigates up to the current month; future months' previews are visible through Projected but not in the calendar.
- MAZ-136 (income dated after today counts toward Projected, shown as expected with an amber ring) lives in `LedgerReport` and the fixtures; this screen code reads its results through `MonthSummary` at `ShellModel.today`.
