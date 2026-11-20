# Visual acceptance against the redesign cards (MAZ-122)

[Redesign cards](penny-ios/README.md) · [Redesign baseline and deviations](../reference/redesign.md) · [Native UI tests](../ios/ui-tests.md) · [Web app](../../apps/web/README.md) · [Test environment](../reference/test-environment.md#redesign-specimens)

The 82 cards in `docs/design/penny-ios` are v2's visual baseline. This page explains how the iOS and web apps are compared with them: the reference images, the captures, what must match and what may differ, where verdicts are recorded, and how to re-sync after a design change.

A visual comparison checks that a screen looks and reads as designed. It does not prove the screen works. Functional checks (the MAZ-82/96 journeys and real-device checks) are still required separately, and a matching capture never replaces them.

## Files

| Path | Contents |
| --- | --- |
| `docs/design/penny-ios/previews/<id>.<appearance>.png` | Reference image of each card in each appearance (162 images: 80 cards × light and dark, plus `iphone-home-dark` and `iphone-receipt`, which are dark only). Committed. |
| `docs/design/penny-ios/previews/manifest.json` | For each image: the card, its viewport, the card's SHA-256, the image's SHA-256, and the hashes of the shared `assets/` it was rendered with |
| `docs/design/penny-ios/render.mjs` | Renders the baselines (`2` is the scale), or checks them (`--check`) |
| `docs/design/penny-ios/compare.mjs` | Builds side-by-side review sheets from a capture run |
| `docs/design/penny-ios/glow-contrast.mjs`, `glow-contrast-known.json` | Measures text contrast over the hero glow, with the known shortfalls |
| `apps/ios/PennyUITests/Cards/`, `apps/ios/TestPlans/Cards.xctestplan` | Native captures of each card's state (XCUITest) |
| `apps/web/e2e/cards.real.spec.ts` | Web captures of each card's state (Playwright) |
| `contracts/visual-comparisons.json` | The verdict for each card on each platform |
| `contracts/fixtures/redesign-states.json` | The seeded data state, view, appearances and fault for each card |

Card ids are the contract ids in `contracts/design-baseline.json` (`<folder>-<file>`, for example `iphone-home`).

## Reference images

```sh
node docs/design/penny-ios/render.mjs 2            # write every baseline and the manifest
node docs/design/penny-ios/render.mjs 2 iphone-home  # only cards whose id contains iphone-home
node docs/design/penny-ios/render.mjs 2 --check    # re-render and compare with the committed images
```

Playwright comes from the repository root or from `apps/web` (`npm ci` there). On NixOS, set `PENNY_DESIGN_CHROME` if Playwright's Chromium doesn't run.

Each card is rendered at its `@dsCard` viewport at 2x, full page, in every appearance its state lists. The rendering is pinned so that it doesn't depend on the machine:

- **Font.** The bundled Inter replaces the system font stack. Monospace runs (the invite code, the receipt and the foundations hex values) are drawn in Inter with tabular figures, because system monospace fonts differ by OS. SF Pro, SF Mono and SF Symbols can't be redistributed, so Inter and Ionicons stand in for them.
- **Dark.** The `dark` class is added to every document, including the screens that sheets embed in an iframe, before any card script runs. The canvas around the device is `#1b1a19`, as on `iphone-home-dark`.
- **Motion.** Animations, transitions and the caret are off.

`--check` compares each fresh render with its committed image at a quarter of the resolution. That absorbs the glyph antialiasing difference between macOS and Linux (up to 3% of pixels at full resolution), while a moved, recolored or resized element still shows. A check fails when an image is missing, its size changed, or more than 0.5% of its downsampled pixels differ by more than 24 of 255 in any channel (`PENNY_BASELINE_TOLERANCE` changes the share). Renders that fail are written to `test-results/design-baselines/`. The web workflow runs the check on every pull request.

A pixel check can't catch a one-word copy change. `apps/web/tests/domain/contracts.test.ts` covers that: it fails when a card or a shared asset changed since its baselines were rendered (the manifest's hashes), when an image doesn't match the manifest, or when `previews/` holds anything else.

## Captures

Each card has a state in `redesign-states.json`: a `full-stack-seeds.json` scenario and alias (or a client-only state), the view to open at the scenario clock (2026-10-15), the appearances, and any injected fault or stale write. The capture runs seed that state in a fresh [test environment](../reference/test-environment.md) and open the view through the app's real UI.

| Platform | Command | Devices and viewports | Output |
| --- | --- | --- | --- |
| iOS | `apps/ios/scripts/ios.sh ui-test cards` | `iphone-*` on the iPhone simulator, `ipad-*` on the iPad simulator in landscape. XCUITest can't add widgets or enroll Face ID, so `system-widgets` and the `iphone-lock` cover are device checks | `test-results/cards/ios/<id>.<appearance>.png`, `report.json` |
| Web | `npm run build && npm run test:e2e:cards` in `apps/web` (starts its own environment; `PENNY_E2E_REUSE_STACK=1` reuses a running one) | `web-*` at 1440×900, `ipad-*` at 1194×834, `iphone-*` at 402×874 | `test-results/cards/web/<id>.<appearance>.png`, `report.json` |

Each report lists every card and appearance with a status: `captured`, `not-built` (the screen or state doesn't exist yet), `blocked` (the state can't be seeded yet, for example `iphone-receipt`), or `not-applicable` (`web-*` cards on iOS, `system-widgets` on the web, and the `system-foundations` token sheet, which `TokenBaselineTests` and `npm run design:check` cover instead).

Then build the review sheets:

```sh
node docs/design/penny-ios/compare.mjs            # every card; or pass an id filter
open test-results/cards/comparison/index.html
```

Each sheet shows the baseline, the iOS capture and the web capture side by side for each appearance. `compare.mjs` also lists every card whose recorded verdict claims more than the run captured, for example "matches" for a card that wasn't captured.

## What must match and what may differ

Compare each capture with its baseline in the same appearance. Judge by what the user reads and understands, not by pixels.

| Must match | May differ |
| --- | --- |
| **Layout:** the regions on the screen and their order, for example the hero, then the flow card, then Recent. Which surface each region sits on: solid for money and lists, glass only for controls. | **Fonts and icons:** SF Pro and SF Symbols on iOS, Inter and Ionicons on the web. Text metrics, wrapping and icon shapes differ. |
| **Hierarchy:** the one number that leads the screen, and the relative size and weight of titles, amounts and secondary text. | **Materials:** real Liquid Glass on iOS. On the web, and in the cards, a CSS blur approximates it. Reduce Transparency replaces glass with an opaque surface. |
| **Meaning colors:** copper is the only action and brand tint. Green means income, indigo investments, amber pending or expected, and red errors and destructive actions. Expenses use the label color, and category colors never take a meaning color. | **Live data:** names, amounts, dates and counts come from the seeded scenario, not the card's sample data. Compare the format and meaning (signs, cents, "your share", "projected"), not the values. |
| **Copy:** labels, empty and error text, and confirmation wording, with the same meaning and tone. Wording may change only through an approved deviation. | **Platform chrome:** the status bar, home indicator, keyboard, system sheets and pickers, the browser window, and the device frame. |
| **States:** the card's state is visible, for example the offline banner with pending rows, a kept draft, or the stale-payment comparison. | **Geometry:** spacing and sizes that follow safe areas, Dynamic Type or a resizable window, as long as layout and hierarchy hold. |

A difference in a "must match" column is either an **approved deviation**, recorded in [redesign.md](../reference/redesign.md#approved-deviations-maz-122) with its reason, or a **defect**, filed against the card's feature issue.

Parity is the goal: every card should reach `matches`. **Only a human approves a deviation.** An agent never adds, widens or rewords an approved deviation. When it can't close a difference, it records a `follow-up` deviation and asks for a design decision ([dev worker, design cards](../development/agents/dev-worker.md#design-cards)). A human approves a deviation by applying the `design-approved` label to its issue and recording the reason in redesign.md.

## Recording verdicts

`contracts/visual-comparisons.json` holds one entry per card, in contract order, with a `native` and a `web` side. Each side has its `owner` (the card's feature issue in the contract) and one of these statuses:

| Status | Meaning | Required fields |
| --- | --- | --- |
| `matches` | Compared in every appearance; nothing in the "must match" column differs | `capture` (device or viewport), `appearances` |
| `deviates` | Compared; every difference is listed | `capture`, `appearances`, `deviations` |
| `not-built` | The screen or state doesn't exist on this platform yet | `note` (what's missing), `followUp` (the issue that builds it) |
| `blocked` | The state can't be seeded yet (`blockedBy` in the states file) | `note` |
| `not-applicable` | The platform has no such screen | `note` |

Each deviation has a `summary`, a `kind` and a `ref`. An `approved` deviation's `ref` is its anchor in `docs/reference/redesign.md`. A `follow-up` deviation (a defect, or a design change still to make) names its `MAZ-` issue. `apps/web/tests/domain/contracts.test.ts` enforces these rules, the owners, the views and the full set of cards. No card may be left unreviewed.

Only a human approves a deviation. The **Design deviations** workflow (`scripts/design-deviations.mjs`) fails a pull request that adds an `approved` deviation to `contracts/visual-comparisons.json` (a new one, a follow-up turned `approved`, or a changed summary or ref), or adds or changes a line under "Approved deviations" in `docs/reference/redesign.md`. Removing approved deviations and their entries passes, so they can become follow-ups. A person overrides the check by applying the `design-approved` label to the pull request; agents never apply it. Run it locally against `origin/master` with `npm --prefix scripts run design-deviations:check`.

To review: run both capture suites, build the sheets, walk through every card, update its entry, and set `reviewedAt`. Commit the record with the change it reviews. Captures aren't committed, because they depend on the simulator, browser and OS. Attach representative sheets to the pull request or the issue.

## Results (2026-11-12)

Both capture suites passed against a fresh environment: iOS on the iPhone 18 Pro and iPad Pro 11-inch (M5) simulators (iOS 27), and the web in Chromium. Every capture opened the card's screen and state. The verdicts are in `contracts/visual-comparisons.json`:

| | Matches | Deviates | Not built | Blocked | Not applicable |
| --- | --- | --- | --- | --- | --- |
| iOS | 8 | 41 | 1 (`system-widgets`: device check) | 2 (`iphone-receipt`, `iphone-lock`) | 9 (web cards, foundations) |
| Web | 1 | 54 | 0 | 1 (`iphone-receipt`) | 5 (widgets, foundations, lock, app lock, server) |

- **iOS** follows the cards closely on iPhone. The differences are mostly approved platform adaptations: the Add entry tab, popovers, local-first saving, and emails as names. The follow-ups (MAZ-179 to MAZ-182) cover the missing hero glow, two keyboard overlaps (sign-in, empty search), entry gaps (category grid, shared trips in the picker, the amount separator), shared and trip detail layouts, and iPad (sidebar households and trips, the two-column Add entry, a collapsing portrait detail pane).
- **The web** shows every card's content, with web forms and dialogs in place of iOS sheets (approved). At phone width it departs further from the iPhone cards. The follow-ups (MAZ-173 to MAZ-178) cover the shell (More instead of the Settings sheet, sidebar households and trips), Home and Insights hierarchy, Activity's layout, shared actions, a stale-payment message that blames the wrong edit, recurring rows that break at 402px, and sign-in, sign-out and feedback copy. MAZ-177 (2026-11-18) re-captured `iphone-recurring`: rows keep the title left and the amount right from 320px, amounts carry the card's signs, and shared schedules are listed with your share. MAZ-174 (2026-11-18) re-captured `iphone-home`, `iphone-home-dark`, `iphone-insights`, `iphone-empty-home`, `iphone-offline`, `ipad-home`, `web-home` and `web-insights`: Home leads with Left to spend and Projected, then Follow your money, then Recent, at every width; the desktop dashboard shows the Sankey and By category above the fold at 1440×900; Insights has the donut and month-over-month sentence on phones and the category table with the last six months on desktop; and the empty month offers Income, Expense and Invest. What remains is listed per card (the sidebar and More are MAZ-173). MAZ-175 (2026-11-18) re-captured `iphone-activity`, `iphone-search-empty`, `iphone-add-income` and `iphone-category-picker`: Activity lists Type and the period, then the day-grouped list with each day's net, before search and the totals at phone width; the empty search state is centered in the results area with Search all time and Clear filters; the Income form explains future-dated income; and the category picker shows Most used and all categories as a grid. MAZ-202 (2026-11-18) signs the recorded rows in Home's Recent and Explore your month and in Activity as the cards do: expenses and shared shares with a minus, income with a plus, investments unsigned; expected and scheduled amounts stay unsigned in amber. MAZ-178 (2026-11-17) re-captured its six cards: the saved toast now matches, sign-out warns about unsynced changes, the offline banner reads Offline, and the remaining sign-in and sign-out differences are approved web adaptations.
- **MAZ-198 (2026-11-19).** `iphone-recurring` was captured again on the iPhone 18 Pro simulator (iOS 27), light and dark. Shared schedules you're part of (the seeded Streaming) are listed with the expenses, marked Shared with the household's name and "your share", and open their household. A paused expense shows its minus sign. The page now has the card's subtitle, small upper-case section labels and compact Paused tag, and every iOS category icon is the design kit's tile (solid category color, white glyph) instead of a tinted circle. The shared row itself isn't on the card, so it stays a `follow-up` deviation until a design decision.
- **MAZ-219 (2026-11-20).** The owner decided to change the card: `iphone-recurring` now shows Streaming as a shared schedule, as the app draws it (the Shared tag beside the title, "Monthly · next Nov 22" with the household's name on its own line, −$8.00 with "your share" under it), and the footer adds "Shared schedules open their household and count only your share." The capture state adds a Payday income and a TFSA contribution schedule to alex's seed, both starting in November so October's totals don't change, so the Income and Investments sections are compared too. iOS now lists the sections in the card's order (Income, Expenses, Investments), draws income and investment tiles as the cards do (an arrow down on income green, the trend line on investment indigo), maps the Fun (`happy`) and Streaming (`tv`) icons instead of falling back to a tag, and puts a schedule's account on its own line when the detail doesn't fit. Both appearances were captured again on the iPhone 18 Pro simulator (iOS 27) and at 402×874 on the web. The native shared row now matches the card, so its deviation is gone; the subtitle spacing (MAZ-236) and copper toolbar glyphs (MAZ-244) remain. On the web the Shared badge sits under the amount, the household's name stays on the timing line, the icon is a gray people glyph and Payday's account wraps after a stranded "·" (MAZ-232).
- **MAZ-180 (2026-11-18).** The nine cards it covered were captured again on the iPhone 18 Pro simulator (iOS 27): the hero glow on Home, empty Home, offline and create account, the Home calendar button, the category picker's Most used grid, shared trips in More details, the grouped draft amount and the Appearance previews. `iphone-create-account`, `iphone-category-picker`, `iphone-add-income` and `iphone-appearance` now match (with MAZ-179's, 15 matches and 34 deviations on iOS); the others keep only approved deviations. The light-mode contrast on the glow is fixed with them (MAZ-183, below).
- **MAZ-181 (2026-11-19).** The nine shared and trip cards were captured again on the iPhone 18 Pro and iPad Pro 11-inch (M5) simulators (iOS 27). The household leads with members, its name and the meaning-colored balance, with the month in the section headers; People has the invite card; the shared expense form shows Paid by and the split above the keypad; Payment changed names its cause and strikes through only what changed; New household has its header and a pinned Create household; the Trips list shows Your share so far; and a shared trip leads with the trip total and your share, with Your share by category on iPad. `iphone-household-create` and `iphone-trips` now match; the others keep only approved deviations, and the iPad layouts remain MAZ-182. The seeded Lisbon trip has no shared expenses yet, so its totals read $0.00 and the iPad category section is empty.
- **Emailed receipts (MAZ-184).** The 21 receipt cards (`iphone-receipt-*`, `ipad-receipt-*`, `web-receipt-*`) were added after this review. Their states are `blockedBy` in `redesign-states.json`: the full-stack seed has no receipt address or inbox items yet, so neither capture suite can open them, and their verdicts are recorded as `blocked` (`not-applicable` for the `web-*` cards on iOS). The counts above cover the 61 cards reviewed on 2026-11-12.

## Web audit (MAZ-215, 2026-11-19)

MAZ-215 captured every web card again against a fresh test environment (`npm run test:e2e:cards`, Chromium, 402×874, 1194×834 and 1440×900) and compared each one with its card, light and dark. It was the first review after parity became the goal ([dev worker, design cards](../development/agents/dev-worker.md#design-cards)), so it approves nothing.

| | Matches | Deviates | Not built | Blocked | Not applicable |
| --- | --- | --- | --- | --- | --- |
| Web | 0 | 55 | 0 | 22 (`iphone-receipt` and the 21 receipt cards) | 5 |

- **No web deviation is `approved` any more.** Each difference the agents had recorded as approved (the web lists in [redesign.md](../reference/redesign.md#approved-deviations-maz-122): Interaction baseline, the MAZ-90 and MAZ-91 notes, and Web adaptations) is now a `follow-up` linked to a decision issue, where a person decides whether the card changes, the deviation is approved, or the web changes. None of them is platform chrome. By the end of the audit a person had already decided three of them: MAZ-224 (add the flow card's accessibility copy to the cards; the web matches the cards on the rest), MAZ-227 (the web form and detail patterns are approved, now recorded under [Web conventions](../reference/redesign.md#web-conventions-maz-227)) and MAZ-229 (the household tab links and invite are approved; the web matches the cards on the rest). Members shown by email moved to MAZ-171. Those issues record their approvals in redesign.md and the verdicts; MAZ-234 is still open. The redesign.md entries stay until each decision is recorded.
- **`iphone-saved-toast` no longer matches.** Since MAZ-166 the toast hides the tab bar, and the capture shows its Undo and wording differ from the card.
- **Follow-ups by area.** Each verdict names the issue for each difference:

| Area | Fix | Decision |
| --- | --- | --- |
| Shell: phone header and tab bar, sidebar households and trips | MAZ-221 | |
| Lists and amounts: category tiles, headers above lists, hero cents, minus sign, dark segmented controls | MAZ-222 | |
| Home, Insights and money flow | MAZ-223 | MAZ-224 |
| Activity and entry detail | MAZ-225 | MAZ-227 |
| Add entry | MAZ-226 | MAZ-227 |
| Shared households | MAZ-228 | MAZ-229 |
| Trips | MAZ-230 (expenses: MAZ-213) | MAZ-229 |
| Settings and Appearance | MAZ-231 | MAZ-234 |
| Recurring, Accounts and Categories | MAZ-232 | MAZ-227 |
| Sign-in, sign-out, sync failure and the saved toast | MAZ-233 | MAZ-234 |
| Capture states that differ from the card's drawn state | MAZ-235 | |
| `iphone-save-error` and `iphone-saved-toast` captures, which time out on the hidden tab bar | MAZ-220 | |

  "Try with sample data" on the empty Home is MAZ-204.
- **MAZ-221 (2026-11-19).** The shell was captured again at 402×874, 1194×834 (with touch, as an iPad) and 1440×900, light and dark, on 18 cards. Phones now have the card's top row (the glass month pill, with the calendar and settings buttons on Home and Back on Insights) over a large title, four tabs with the copper add button beside them, and Home selected on Insights; Settings › Manage replaces More. The sidebar lists each household with its balance and each current or coming trip with its start date, Recurring shows its count, the footer reads Synced just now, the desktop month control is segmented, and on a touch tablet the selected item is filled copper. What remains is recorded per card: an All households link (and, on the iPad cards, All trips and a date instead of a count), Waiting for a design decision; the iPad search button; Settings as a page rather than a sheet; and the footer's email (MAZ-171).
- **MAZ-222 (2026-11-19).** Lists and amounts were captured again at 402×874, 1194×834 and 1440×900, light and dark, on the eleven cards that named it. Row and category icons are the cards' tiles: a filled tile in the category's color with a white glyph, green for income entries and indigo for investments. A stored category color is drawn in the redesign palette (`apps/web/src/design/categoryTint.ts`, the same mapping as iOS), so the default Food & drinks color (#E47850, near copper) draws pink and no category takes the action tint, in the tiles, bars, the Insights donut and the money flow's expense bands. Below 1100px, Recent and Insights' Categories put their heading above one solid list card, and Activity's days are solid cards with inset dividers. Left to spend shows its cents smaller and dimmed. Negative amounts use the typographic minus directly before the number (−$48.90), also in the sidebar. Insights shows each category's amount over its percent, and By category on Home shows the amount alone. In dark, the selected segment of segmented controls is the kit's lighter pill (#4A4744). The other differences on these cards stay with their own issues.
- **MAZ-224 (2026-11-20).** A person decided the Home, Insights and money flow differences the agents had recorded as approved. The cards changed to include the flow card's accessibility copy: `iphone-money-flow`, `ipad-home`, `web-home` and `web-insights` now show the focus hint "Select a band or label to focus it, again to clear" and Show as a table (re-rendered baselines; the native screens follow as a follow-up). The web matches the cards on the rest, captured again at 402×874, 1194×834 and 1440×900, light and dark: at phone width Money flow is its own screen (`/money-flow`, "From coming in to going out") with the Sankey, opened from the Follow your money card's title; the calendar is a sheet over Home with Close, the month, Today and the selected day's entries; the hero has the cards' short projected line and no "Recorded so far" note; Home shows only the hero, the flow card and Recent on phones and no Recent on desktop; Insights has no money flow on phones, no This month link and no visible "Spending by category" title; and the empty month has no Currency link. The Web adaptations entries for money flow on phones, the calendar, and Home and Insights are removed from redesign.md. What remains on these cards is MAZ-223 and MAZ-235.
- **Web screens and states with no card.** The design doesn't draw these yet: the household list (`/households`) and a shared expense's detail (`/households/$id/expenses/$expenseId`) at desktop width; a trip at desktop width (`/trips/$id`, only `ipad-trip`); Recurring, Accounts and Categories at tablet and desktop widths; the Currency and Server settings panes; New schedule and Edit entry dialogs; Join a household or trip with a code; the demo banner; the server-unreachable banner; Activity's Searching… state; and the 768–1099px layouts between the phone and desktop cards.

## iOS audit (MAZ-216, 2026-11-19)

MAZ-216 captured every iOS card again against a fresh test environment (`apps/ios/scripts/ios.sh ui-test cards`: `iphone-*` on the iPhone 18 Pro simulator and `ipad-*` on the iPad Pro 11-inch (M5) simulator in landscape, iOS 27) and compared each one with its card, light and dark. Like the web audit, it approves nothing.

| | Matches | Deviates | Not built | Blocked | Not applicable |
| --- | --- | --- | --- | --- | --- |
| iOS | 0 | 49 | 1 (`system-widgets`: device check) | 16 (`iphone-receipt`, `iphone-lock` and the 14 iPhone and iPad receipt cards) | 16 (the `web-*` cards and `system-foundations`) |

- **Every captured iOS card now deviates.** The 17 cards recorded as `matches` (among them `iphone-add-expense`, `iphone-trips`, `iphone-sign-in` and the Manage pages) differ from their cards in the fresh captures, mostly in section headers, toolbar actions, copy and the state the capture opens.
- **Only the confirmation popover stays `approved`.** iOS 27 presents a system confirmation dialog as a popover anchored to its button, which is a system sheet (platform chrome), so that entry stays on `iphone-delete-confirm` and `iphone-sign-out`. What the dialog can't show (the card's icon, amount line and Sync, then sign out) is a follow-up. Every other difference the agents had recorded as approved (the MAZ-69 and MAZ-77 notes and the native list under Native adaptations in [redesign.md](../reference/redesign.md#native-adaptations-maz-122)) is now a `follow-up` linked to a decision issue. Members shown by email moved to MAZ-171; Lock after was built in MAZ-133, and the capture doesn't turn the lock on, so it's a capture-state follow-up. The redesign.md entries stay until each decision is recorded.
- **Follow-ups by area.** Each verdict names the issue for each difference:

| Area | Fix | Decision |
| --- | --- | --- |
| Lists and rows: section headers, day headers, row subtitles, icon tiles, neutral close and + glyphs | MAZ-244 | |
| Home, Insights, calendar, empty month and offline | MAZ-245 | MAZ-254 |
| Activity and entry detail | MAZ-246 | MAZ-255 |
| Add entry, More details and Split | MAZ-247 | MAZ-255 |
| Shared households | MAZ-248 | MAZ-256, MAZ-171 (names) |
| Trips | MAZ-249 (expenses: MAZ-213) | MAZ-256 |
| Settings, Appearance and Face ID lock | MAZ-250 | MAZ-254, MAZ-257 |
| Recurring, Accounts and Categories | MAZ-251 (shared row: MAZ-219, subtitle: MAZ-236) | MAZ-257 |
| Sign-in, create account, server connect, save banners and sign-out | MAZ-252 | MAZ-257 |
| iPad sidebar, toolbar and two-column layouts | MAZ-182 | MAZ-240 |
| Capture states that differ from the card's drawn state | MAZ-253 (web: MAZ-235) | |

- **MAZ-182 (2026-11-20).** The six iPad cards (`ipad-home`, `ipad-activity`, `ipad-add-entry`, `ipad-shared`, `ipad-trip`, `ipad-settings`) were captured again on the iPad Pro 11-inch (M5) simulator in landscape (iOS 27), light and dark. The sidebar has the penny. mark, Insights, each household with its balance, the current and coming trips with their start date, All households and All trips (decided in MAZ-240; the cards follow), small upper-case section labels, a copper selection and the account's monogram. A household or shared trip shows the balances beside the expenses, Settings shows the chosen page beside the list, and Add entry is a centered two-column sheet that uses the keyboard. The Activity detail beside the list no longer collapses in portrait: when the two don't fit, the list pushes the entry (`IPadActivityLayoutTests`). The cards still deviate; what remains is listed per card, with four new follow-ups recorded on MAZ-182 (the toolbar's search and Add entry capsule, the selected shared expense beside the balances, Add entry's detail rows, and the title of the Settings page beside the list).
- **iOS screens and states with no card.** The design doesn't draw these yet: the Activity filters sheet; the account, household and date pickers; Spending by category; the Currency page; Edit entry; a shared expense's detail; recording a monthly payment; Join with a code and the invite scanner; the invite sheet with its QR code; sharing a personal trip; a personal trip's page (only shared trips have cards); New schedule; the Explore your month list and Coming up on iPhone; the Expected income card; the notification prompt and the Notifications row; the "Shared expenses may be missing" and server-unreachable banners; the demo banner; Activity's "Searching your server…" state; and iPad in portrait and in compact widths.

## Review scenarios

A capture shows one state at one size. The scenarios below are covered by these suites, so a card review doesn't need to repeat them:

| Scenario | iOS | Web |
| --- | --- | --- |
| 320px through desktop | iPhone and iPad simulators; iPad compact widths use the iPhone tab bar ([shell](../ios/shell.md)) | `shell.spec.ts` at 320, 390, 768, 1024, 1100 and 1440px with no horizontal scrolling; `visual.spec.ts` at 320, 768 and 1440px |
| iPhone and iPad | Cards plan on both simulators; `ScreenshotTests` | Phone and tablet Playwright projects (`PENNY_E2E_DEVICES`) |
| Light and dark | Cards plan and `ScreenshotTests` in both; `AccessibilityAuditTests` in both | Cards spec and `visual.spec.ts` in both |
| Text scaling | `ScreenshotTests` and `AccessibilityAuditTests` at accessibility XL | `shell.spec.ts`: 200% zoom and doubled text |
| Contrast on the hero glow | `glow-contrast.mjs` on the cards (below); `AccessibilityAuditTests` contrast audit on the app | `glow-contrast.mjs` on the cards; `a11y.spec.ts` (axe color-contrast) on the app |
| Reduce Transparency and Reduce Motion | `ScreenshotTests` variants | Settings › Reduce transparency (`shell.spec.ts`); `a11y.spec.ts` with forced colors and reduced motion |
| VoiceOver and keyboard | `AccessibilityAuditTests`: labels, keyboard-safe Add entry | `a11y.spec.ts` (axe), keyboard journeys in `shell.spec.ts` and `transactions.spec.ts` |

### Contrast on the hero glow

```sh
node docs/design/penny-ios/glow-contrast.mjs   # every card with a glow, light and dark
```

For each text run over a `.glow`, the script renders the card with text hidden, reads the pixels behind the text, and takes the lowest WCAG contrast. Text needs 4.5:1, or 3:1 when large. Dark and light both pass on every card. In light, secondary text over the copper glow used to measure 3.4–4.4:1 with `--label-2` at #6F6A64; MAZ-183 (decided in MAZ-180) darkened the light `--label-2` to #57524D in the cards, `design-kit`, the web tokens and `Tokens.swift`, which keeps it 6.8:1 on the background and about 4.9:1 at the glow's brightest point. The empty Home's "$0" now uses `--label-2` instead of `--label-3`, and the iPad trip's phase ("In 3 days") uses `--label-2` instead of amber, on the cards and in the app. `glow-contrast-known.json` is empty. The script fails on any shortfall, and on a listed one that now passes, so the list stays current. The web workflow runs it on every pull request.

## Design gaps

The cards are static and show one state each. These gaps were open at the MAZ-132 re-baseline:

| Gap | Resolution |
| --- | --- |
| Larger text | **Filled by the platform rule.** iOS uses Dynamic Type styles. At accessibility sizes, the iPad dashboard falls back to the iPhone layout, the money flow and Insights chart give way to their value lists, the calendar grid becomes a list of days, and Insights and recurring rows stack ([native overview](../ios/overview.md)). The web follows the browser's text size and zoom with no horizontal scrolling. `ScreenshotTests`, `AccessibilityAuditTests` and `shell.spec.ts` capture these. No card is drawn per text size. |
| Real keyboard and focus | **Filled by the platform rule.** iPhone Add entry keeps the always-visible keypad. Text fields use the system keyboard, and Save stays reachable above it (`AccessibilityAuditTests`). On iPad, Add entry uses the keyboard instead of the keypad. The web draws a copper focus ring on every focusable element (`:focus-visible`) and has the shortcuts on the cards: N for Add entry, ⌘K for search, ⌘↵ to save and Esc to close (`transactions.spec.ts` adds an expense with the keyboard only). |
| Native pickers | **Filled by the platform rule.** The date, split and repeat rows open the system controls: SwiftUI `DatePicker` and `Picker` in a sheet on iOS, and a date input and native `select`s on the web. The cards show only the labeled row that opens them. The category and account pickers are custom lists, and the category picker has its card (`iphone-category-picker`). |
| App lock | **Filled.** `iphone-lock` and `iphone-app-lock` show the lock and its settings. The lock draws no amount behind it (an approved deviation). The **Lock after** delay is MAZ-133. The web has no lock. |
| Server-search loading and empty states | **Filled by the implementations.** While the server searches, Activity shows a progress state ("Searching your server…" on iOS, "Searching…" on the web) in place of the results. The empty state is `iphone-search-empty`. Both are recorded as approved deviations of `iphone-search-empty` and `web-activity`. |
| Light-mode contrast on the hero glow | **Filled** by MAZ-183, decided in MAZ-180: a darker light `--label-2` (measured above). |

## Re-sync after a design change

A change to a card, a shared asset in `docs/design/penny-ios/assets/`, or a `design-kit` component goes through these steps in one pull request:

1. **Cards and kit.** Edit the card and, if a token or component changed, `design-kit/src/styles.css` and the component. Tokens are copied by hand, so check both ([design-sync notes](../../.design-sync/NOTES.md#re-sync-risks)).
2. **Baselines.** Run `node docs/design/penny-ios/render.mjs 2` (or with an id filter for one card), and `glow-contrast.mjs`. Review the changed PNGs in the diff.
3. **Contract.** Update the card's `sha256` and the `sources` hashes in `contracts/design-baseline.json`. Add or update its state in `redesign-states.json` if the data it shows changed.
4. **Claude Design.** Re-sync the kit and cards to the [Penny Claude Design project](https://claude.ai/design/p/173b576e-aa32-44dc-9f83-23f0ea8df538) as `.design-sync/NOTES.md` describes, and record any new render warnings there.
5. **Verdicts.** Set the changed cards' entries in `contracts/visual-comparisons.json` back to what the implementations show now. A design change usually turns `matches` into `deviates` (with a follow-up) until the apps catch up.
6. **Check.** Run `npm test` in `apps/web` (contract and baseline hashes, `tests/domain/contracts.test.ts`) and `render.mjs 2 --check`.
