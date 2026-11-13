# Visual acceptance against the redesign cards (MAZ-122)

[Redesign cards](penny-ios/README.md) · [Redesign baseline and deviations](../reference/redesign.md) · [Native UI tests](../ios-ui-tests.md) · [Web app](../../apps/web/README.md) · [Test environment](../reference/test-environment.md#redesign-specimens)

The 61 cards in `docs/design/penny-ios` are v2's visual baseline. This page explains how the iOS and web apps are compared with them: the reference images, the captures, what must match and what may differ, where verdicts are recorded, and how to re-sync after a design change.

A visual comparison checks that a screen looks and reads as designed. It does not prove the screen works. Functional checks (the MAZ-82/96 journeys and real-device checks) are still required separately, and a matching capture never replaces them.

## Files

| Path | Contents |
| --- | --- |
| `docs/design/penny-ios/previews/<id>.<appearance>.png` | Reference image of each card in each appearance (120 images: 59 cards × light and dark, plus `iphone-home-dark` and `iphone-receipt`, which are dark only). Committed. |
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

A pixel check can't catch a one-word copy change. `tests/core/contracts.test.ts` covers that: it fails when a card or a shared asset changed since its baselines were rendered (the manifest's hashes), when an image doesn't match the manifest, or when `previews/` holds anything else.

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

## Recording verdicts

`contracts/visual-comparisons.json` holds one entry per card, in contract order, with a `native` and a `web` side. Each side has its `owner` (the card's feature issue in the contract) and one of these statuses:

| Status | Meaning | Required fields |
| --- | --- | --- |
| `matches` | Compared in every appearance; nothing in the "must match" column differs | `capture` (device or viewport), `appearances` |
| `deviates` | Compared; every difference is listed | `capture`, `appearances`, `deviations` |
| `not-built` | The screen or state doesn't exist on this platform yet | `note` (what's missing), `followUp` (the issue that builds it) |
| `blocked` | The state can't be seeded yet (`blockedBy` in the states file) | `note` |
| `not-applicable` | The platform has no such screen | `note` |

Each deviation has a `summary`, a `kind` and a `ref`. An `approved` deviation's `ref` is its anchor in `docs/reference/redesign.md`. A `follow-up` deviation (a defect, or a design change still to make) names its `MAZ-` issue. `tests/core/contracts.test.ts` enforces these rules, the owners, the views and the full set of cards. No card may be left unreviewed.

To review: run both capture suites, build the sheets, walk through every card, update its entry, and set `reviewedAt`. Commit the record with the change it reviews. Captures aren't committed, because they depend on the simulator, browser and OS. Attach representative sheets to the pull request or the issue.

## Results (2026-11-12)

Both capture suites passed against a fresh environment: iOS on the iPhone 18 Pro and iPad Pro 11-inch (M5) simulators (iOS 27), and the web in Chromium. Every capture opened the card's screen and state. The verdicts are in `contracts/visual-comparisons.json`:

| | Matches | Deviates | Not built | Blocked | Not applicable |
| --- | --- | --- | --- | --- | --- |
| iOS | 8 | 41 | 1 (`system-widgets`: device check) | 2 (`iphone-receipt`, `iphone-lock`) | 9 (web cards, foundations) |
| Web | 0 | 55 | 0 | 1 (`iphone-receipt`) | 5 (widgets, foundations, lock, app lock, server) |

- **iOS** follows the cards closely on iPhone. The differences are mostly approved platform adaptations: the Add entry tab, popovers, local-first saving, and emails as names. The follow-ups (MAZ-179 to MAZ-182) cover the missing hero glow, two keyboard overlaps (sign-in, empty search), entry gaps (category grid, shared trips in the picker, the amount separator), shared and trip detail layouts, and iPad (sidebar households and trips, the two-column Add entry, a collapsing portrait detail pane).
- **The web** shows every card's content, with web forms and dialogs in place of iOS sheets (approved). At phone width it departs further from the iPhone cards. The follow-ups (MAZ-173 to MAZ-178) cover the shell (More instead of the Settings sheet, sidebar households and trips), Home and Insights hierarchy, Activity's layout, shared actions, a stale-payment message that blames the wrong edit, recurring rows that break at 402px, and sign-in, sign-out and feedback copy.

## Review scenarios

A capture shows one state at one size. The scenarios below are covered by these suites, so a card review doesn't need to repeat them:

| Scenario | iOS | Web |
| --- | --- | --- |
| 320px through desktop | iPhone and iPad simulators; iPad compact widths use the iPhone tab bar ([shell](../ios-shell.md)) | `shell.spec.ts` at 320, 390, 768, 1024, 1100 and 1440px with no horizontal scrolling; `visual.spec.ts` at 320, 768 and 1440px |
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

For each text run over a `.glow`, the script renders the card with text hidden, reads the pixels behind the text, and takes the lowest WCAG contrast. Text needs 4.5:1, or 3:1 when large. Dark passes everywhere. In light, 26 runs on 15 cards fall short: secondary text (`--label-2`) over the copper glow measures 3.4–4.4:1, the iPad trip's amber "In 3 days" measures 2.9:1, and the empty Home's muted "$0" measures 1.9:1. They are listed in `glow-contrast-known.json`. The script fails on any new shortfall, and on a listed one that now passes, so the list stays current. The web workflow runs it on every pull request. Fixing them means choosing a token change across the cards, `design-kit` and both apps (MAZ-183).

## Design gaps

The cards are static and show one state each. These gaps were open at the MAZ-132 re-baseline:

| Gap | Resolution |
| --- | --- |
| Larger text | **Filled by the platform rule.** iOS uses Dynamic Type styles. At accessibility sizes, the iPad dashboard falls back to the iPhone layout, the money flow and Insights chart give way to their value lists, the calendar grid becomes a list of days, and Insights and recurring rows stack ([native overview](../ios-overview.md)). The web follows the browser's text size and zoom with no horizontal scrolling. `ScreenshotTests`, `AccessibilityAuditTests` and `shell.spec.ts` capture these. No card is drawn per text size. |
| Real keyboard and focus | **Filled by the platform rule.** iPhone Add entry keeps the always-visible keypad. Text fields use the system keyboard, and Save stays reachable above it (`AccessibilityAuditTests`). On iPad, Add entry uses the keyboard instead of the keypad. The web draws a copper focus ring on every focusable element (`:focus-visible`) and has the shortcuts on the cards: N for Add entry, ⌘K for search, ⌘↵ to save and Esc to close (`transactions.spec.ts` adds an expense with the keyboard only). |
| Native pickers | **Filled by the platform rule.** The date, split and repeat rows open the system controls: SwiftUI `DatePicker` and `Picker` in a sheet on iOS, and a date input and native `select`s on the web. The cards show only the labeled row that opens them. The category and account pickers are custom lists, and the category picker has its card (`iphone-category-picker`). |
| App lock | **Filled.** `iphone-lock` and `iphone-app-lock` show the lock and its settings. The lock draws no amount behind it (an approved deviation). The **Lock after** delay is MAZ-133. The web has no lock. |
| Server-search loading and empty states | **Filled by the implementations.** While the server searches, Activity shows a progress state ("Searching your server…" on iOS, "Searching…" on the web) in place of the results. The empty state is `iphone-search-empty`. Both are recorded as approved deviations of `iphone-search-empty` and `web-activity`. |
| Light-mode contrast on the hero glow | **Deferred** to MAZ-183 (measured above). |

## Re-sync after a design change

A change to a card, a shared asset in `docs/design/penny-ios/assets/`, or a `design-kit` component goes through these steps in one pull request:

1. **Cards and kit.** Edit the card and, if a token or component changed, `design-kit/src/styles.css` and the component. Tokens are copied by hand, so check both ([design-sync notes](../../.design-sync/NOTES.md#re-sync-risks)).
2. **Baselines.** Run `node docs/design/penny-ios/render.mjs 2` (or with an id filter for one card), and `glow-contrast.mjs`. Review the changed PNGs in the diff.
3. **Contract.** Update the card's `sha256` and the `sources` hashes in `contracts/design-baseline.json`. Add or update its state in `redesign-states.json` if the data it shows changed.
4. **Claude Design.** Re-sync the kit and cards to the [Penny Claude Design project](https://claude.ai/design/p/173b576e-aa32-44dc-9f83-23f0ea8df538) as `.design-sync/NOTES.md` describes, and record any new render warnings there.
5. **Verdicts.** Set the changed cards' entries in `contracts/visual-comparisons.json` back to what the implementations show now. A design change usually turns `matches` into `deviates` (with a follow-up) until the apps catch up.
6. **Check.** Run `npm run test:core` (contract and baseline hashes) and `render.mjs 2 --check`.
