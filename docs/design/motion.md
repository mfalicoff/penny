# Motion in Penny (MAZ-287)

[Redesign cards](penny-ios/README.md) · [Visual acceptance](visual-acceptance.md) · [Redesign baseline](../reference/redesign.md) · [Demo page](motion/demo.html)

**Status: draft for the owner's review.** Nothing here is built yet. Once it's approved, this page is the reference for motion on iOS and the web. The cards are static (their renderer turns animation off), so they show where things end up; this page says how they get there.

To see every moment, open [motion/demo.html](motion/demo.html) in a browser straight from the checkout. It uses the kit's tokens and the timings below, and has a switch that simulates reduced motion.

## Principles

1. **Motion explains a change.** Something moves only to show what changed, where it came from or where it went: a saved row, a new total, the next month. Nothing moves for decoration. No loops except progress, no parallax, no bouncing, and the hero glow stays still.
2. **Fast, and never in the way.** Most motion lasts 150 to 250 ms. Input is never delayed: a control works the moment it's on screen, a sheet can be dismissed while it opens, and a second tap retargets the animation from where it is instead of queuing another one.
3. **Direction means something.** Earlier is to the leading edge, later to the trailing edge. Things that arrive come up from where they belong (a toast from the bottom, a drawer from its edge).
4. **One platform language each.** iOS uses SwiftUI's springs and the system's own animations for system components. The web mirrors the same timings with CSS tokens. Both read as the same app, not the same pixels.
5. **Readable while it moves.** Amounts keep tabular figures, rows never rewrap mid-animation (a column that resizes truncates its text instead), and charts keep their labels in place while bars and bands change.
6. **Felt as well as seen on iOS.** Every action the person takes that animates also plays one haptic ([Haptics](#haptics-ios)).
7. **Motion is never the only signal.** Every change it shows is also visible when it's off: the toast says "Saved", the new total is on screen, the error text names the problem.

## Tokens

Four durations and three easings. Every animation in the app uses one of them; nothing else picks its own timing.

### Durations

| Token | Value | Use it for |
| --- | --- | --- |
| `quick` | 150 ms | Small state changes in place: a press, hover, a switch, a checkbox, a chevron turning, a highlight dimming the others, a menu opening, a crossfade of a label or icon. Every exit that isn't a full screen. |
| `standard` | 250 ms | Things that change the layout or arrive: a row inserted or removed, a toast, a dialog, a disclosure expanding, the sync status changing. The default when unsure. |
| `emphasized` | 400 ms | Changes of a whole view and its numbers: a month or period change, charts moving to new values, totals counting, the web drawer and Activity's detail panel. |
| `linger` | 1000 ms | Only the fade of the "this changed" highlight on a saved row. Never for movement. |

Exits are faster than entrances: an element that leaves uses `quick` (or `standard` for a whole view), because the person's attention has already moved on.

### Easings

| Token | CSS | SwiftUI | Use it for |
| --- | --- | --- | --- |
| `standard` | `cubic-bezier(0.2, 0, 0, 1)` | `.snappy(duration:)` | Anything that enters or moves to a new place. Starts fast, settles gently. |
| `exit` | `cubic-bezier(0.4, 0, 1, 1)` | `.easeIn(duration:)` | Anything that leaves the screen. |
| `linear` | `linear` | `.linear(duration:)` | Progress (the spinner) and the highlight fade. Nothing that moves. |

On iOS, `standard` is a spring: `.snappy` has no overshoot you can see at these durations, and a spring keeps the velocity when it's retargeted, which a curve doesn't. Interactive gestures (dragging a sheet, swiping a row) follow the finger and are the system's own.

### Distances

Movement is short: things slide a little and fade, they don't travel across the screen.

| Token | Value | Use it for |
| --- | --- | --- |
| `nudge` | 8 pt | A row or toast arriving, a menu opening |
| `shift` | 24 pt | A month's content sliding in, the detail panel arriving |
| `shake` | 6 pt | The refused-field shake, each way |
| `press` | scale 0.97 | A pressed custom button or row |

## Moments

Each moment names what moves, how, and for how long. "Reduced" is the behavior with Reduce Motion on iOS or `prefers-reduced-motion: reduce` on the web (see [Reduced motion](#reduced-motion)).

### 1. Saving

| What | Motion | Token | Reduced |
| --- | --- | --- | --- |
| **New row in Recent (Home) and Activity** | The rows below make room (height grows from 0), and the new row fades in while rising `nudge`. Then its background shows `tint-soft` and fades it out, so you can see which row is new. | `standard` + `standard` easing; highlight fade `linger`, `linear` | Rows make room at once; the row fades in (`quick`). The highlight stays, it isn't motion. |
| **Edited row** | If its place in the list changes (a new date or amount), it moves there, and the rows it passes shift with it. The changed text crossfades. Then the same highlight. | `standard` | It's at its new place at once; text crossfades (`quick`). Highlight as above. |
| **Saved toast** | Rises `nudge` from the bottom edge with a fade. Leaves with a fade and drops `nudge`. Its timeout and Undo are unchanged. | in `standard`, out `quick` + `exit` | Fades in and out (`quick`), no movement. |
| **Totals** (the Left to spend hero, the flow card's spent / invested / left, came in / went out / left over, a household's balance) | The number counts from the old value to the new one, digit by digit, with tabular figures so its width doesn't jitter. The flow card's bar segments move to their new widths together. | `emphasized`, `standard` easing | The new number and widths appear at once. |

Assistive technology always hears the final value only, once: VoiceOver and `aria-live` don't read the intermediate numbers.

### 2. Month and period changes

| What | Motion | Token | Reduced |
| --- | --- | --- | --- |
| **The month's content** (Home, Activity, Insights, a household's month) | The old content fades out. The new content fades in while sliding `shift` from the side it comes from: an earlier month enters from the leading edge (moving right), a later one from the trailing edge. Right-to-left layouts mirror it. The month control itself doesn't move; its label crossfades. | out `quick`; in `emphasized`, `standard` easing | Crossfade (`quick`), no slide. |
| **The money flow (Sankey)** | Bands and nodes move and resize from their old values to the new ones; a band that appears grows from zero width, one that disappears shrinks to zero. Labels crossfade. | `emphasized` | Crossfade to the new diagram (`quick`). |
| **By category and Insights bars, the donut** | Each bar's length and each donut segment's angle moves to its new value. Categories that join or leave fade. The list reorders with the row move from Lists. | `emphasized` | New values at once; reordering happens at once. |
| **Daily spending (iPad and web Home)** | Bars grow or shrink to their new heights. | `emphasized` | New heights at once. |

Stepping quickly through months never queues animations: each change starts from wherever the last one is. The content is interactive during the whole animation.

### 3. Lists

| What | Motion | Token | Reduced |
| --- | --- | --- | --- |
| **Insert** (sync brings a row, Undo restores one) | As the new row in Saving, without the highlight unless the person made the change. | `standard` | Rows make room at once; the row fades in (`quick`). |
| **Delete** | The row fades out, then the space closes. On iOS a swipe-to-delete is the system's own. | `standard`, `exit` easing | The row fades out (`quick`); the space closes at once. |
| **Bulk actions in Activity** (delete selected, change category or account) | All affected rows animate together, with no stagger, so 50 rows take as long as one. Rows that move to another day's group move there. Day totals count to their new values (`emphasized`). | `standard` | As Delete and Insert reduced; totals at once. |
| **Undo** | Restored rows come back with the Insert motion at their old places. | `standard` | As Insert reduced. |
| **Selection** (Activity's checkboxes, the selection bar) | The checkbox fills; the selection bar rises `nudge` from the bottom. | checkbox `quick`; bar `standard` | Checkbox fills at once; the bar fades in (`quick`). |

### 4. Sheets, menus and disclosures

System components keep the system's motion and are never restyled: iOS sheets and their detents, `Menu`, pickers, `confirmationDialog`, alerts, popovers and the keyboard. The rows below are the parts Penny draws itself, and the web.

| What | Motion | Token | Reduced |
| --- | --- | --- | --- |
| **Web dialog** (add entry, confirmations, the category picker) | The scrim fades in. The panel fades in while rising `nudge` (from the bottom edge on narrow screens, where it's a sheet: it slides up its own height). Closing is the reverse, faster. | in `standard`; out `quick` + `exit` | Scrim and panel fade (`quick`). |
| **Web drawer** (`dialog__panel--drawer`) | Slides in from the trailing edge, its full width; the scrim fades. | in `emphasized`; out `standard` + `exit` | Fades (`quick`). |
| **Web menus and popovers** (the category menu, account and household pickers, the row menu) | Fade in while scaling from 0.97 at the edge they open from. | in `quick`; out `quick` + `exit` | Fade (`quick`). |
| **Disclosures** ("Show as a table", Entry details' extras, Activity's filters) | The chevron turns. The content's height grows and the content fades in; collapsing is the reverse. | chevron `quick`; height `standard` | Chevron turns at once; content appears at once. |
| **Penny's own confirmations on iOS** (`Confirmations.swift`) | As the web dialog. | `standard` | Fade (`quick`). |

### 5. Feedback

| What | Motion | Token | Reduced |
| --- | --- | --- | --- |
| **Press** | Custom buttons, rows and chips scale to `press` while held and back on release. System button styles on iOS keep their own press. | `quick` | Opacity dims to 0.7 instead of scaling. |
| **Refused field** (a save the rules refuse: no amount, no category) | The field shakes horizontally: three swings of `shake`, settling at rest. The haptic `.error` (iOS) fires with it. The error text and red outline appear at once. | 300 ms in total (two `quick`s), `standard` easing | No shake. The error text, outline and haptic stay. |
| **Sync status** (pending, syncing, synced, couldn't sync) | The icon and text crossfade. Syncing shows the system spinner (iOS `ProgressView`, the web's existing spinner at 800 ms per turn). The offline and couldn't-sync banners slide down `nudge` and fade in. | crossfade `standard`; banner `standard` | Crossfade `quick`; the banner fades in. The spinner keeps turning: it's progress, not movement through space. |
| **Switches, segmented controls** | The system's own on iOS. On the web, the thumb or the selection slides to its place. | `quick` | Jumps to its place. |

### 6. Navigation

| What | Motion | Token | Reduced |
| --- | --- | --- | --- |
| **iPad sidebar** (`NavigationSplitView`) | The system's own show and hide, started with `withAnimation(.snappy)` when Penny changes the column visibility. | system | System (it follows Reduce Motion). |
| **Web Activity detail panel** | Opening, it fades in while sliding `shift` from the trailing edge, and the list narrows with it. Selecting another entry crossfades the panel's content without moving it. Closing reverses, faster. | open `emphasized`; switch `quick`; close `standard` + `exit` | Fades (`quick`); the list narrows at once. |
| **Tabs and sidebar destinations** | No transition: a tab or a sidebar item changes the view at once, as iOS tab bars do. | — | — |
| **Pushed screens on iOS** | The system's navigation push. | system | System. |
| **Web routes** | No page transition. | — | — |

## Haptics (iOS)

On iOS, **every action the person takes that animates also plays a haptic**, so it's felt as well as seen. The rule:

- **One haptic per action**, played when the action happens, at the start of its animation; nothing waits for it. Saving plays one haptic, even though the row, the toast and the totals all move.
- **Only for what the person did.** A change that arrives on its own doesn't vibrate: a sync that brings rows from another device, a background sync finishing, a total updated by someone else in a household. A haptic you didn't cause feels like a notification.
- **The meaning decides the kind of haptic**, as with color: success when something is saved, error when it's refused or fails, warning before something destructive, selection when choosing or stepping, and a light impact when something opens or closes.
- **System components keep their own haptics** (pickers tick, context menus, swipe actions reaching their full swipe, the keyboard). Penny doesn't add a second one on top.
- **Haptics stay under Reduce Motion.** They aren't motion, and when the movement becomes a fade they're one of the signals that remain. The system's **Settings › Sounds & Haptics › System Haptics** switch turns them all off; Penny has no switch of its own. Devices without a Taptic Engine (most iPads) play nothing, which is fine, because no haptic carries information on its own.

| Action | Haptic (`SensoryFeedback`) |
| --- | --- |
| **Saving:** save a new entry, save an edit (row, toast, totals) | `.success` (exists today: `savedCount`) |
| Save refused by the rules (the shake) | `.error` (exists today: `refusedCount`) |
| Save or sync failed (the couldn't-sync banner after the person's action) | `.error` (exists today: `failedCount`) |
| Undo (from the saved toast or after a delete) | `.impact(weight: .light)` |
| **Month and period:** step to another month or period, pick one in the calendar | `.selection` |
| Focus a chart element (a Sankey band or label, a category in Insights) | `.selection` |
| **Lists:** delete an entry (after its confirmation, or a full swipe) | `.impact(weight: .medium)`; the system's own on a full swipe |
| Bulk change or delete in Activity | One `.impact(weight: .medium)`, however many rows |
| Select or deselect a row in Activity's selection mode | `.selection` |
| **Sheets and menus:** open or close a Penny-drawn sheet, menu or popover (add entry, the category menu, Show as a table) | `.impact(weight: .light)` |
| A disclosure opens or closes (Entry details' extras, filters) | `.selection` |
| A destructive confirmation appears (delete, sign out with pending changes, leave a household) | `.warning` |
| **Feedback:** a custom button, chip or row press that runs an action | That action's haptic from this table, on release; a press that only opens or toggles plays `.impact(weight: .light)` |
| A switch or segmented control (Expense, Income, Invest) | `.selection` (system controls already play it) |
| Sync now / Retry finishes | `.success`, or `.error` if it failed |
| **Navigation:** show or hide the iPad sidebar | `.impact(weight: .light)` |
| Open an entry, a household or a trip (push, or the iPad detail column) | `.selection` |

Tabs switch with no animation, so they play no haptic either.

On the web there are no haptics: Safari doesn't support `navigator.vibrate`, and Penny has no Android app.

## Reduced motion

When Reduce Motion (iOS) or `prefers-reduced-motion: reduce` (web) is on:

- **Nothing slides, scales, shakes or counts.** Every movement in the tables above becomes a short fade (`quick`) or happens at once, as each row's "Reduced" column says.
- **Fades stay, at `quick`.** A crossfade is a change of state, not motion through space, and it still shows that something changed. This follows Apple's guidance for Reduce Motion.
- **State that isn't motion stays:** the saved row's highlight, the error outline and text, the haptics, progress spinners.
- **System components follow the system:** iOS sheets, pushes, menus and the sidebar already respect Reduce Motion; Penny doesn't override them.
- **Nothing important depends on motion** in either mode, and nothing waits for an animation to finish before the next input works or focus moves.

On the web, Settings › Appearance doesn't get its own motion switch: the operating system setting is the one switch, as on iOS.

## Platform mapping

### SwiftUI

The tokens live in `PennyDesign` next to the other tokens, as a `Motion` namespace that both PennyUI and the widgets use:

```swift
public enum Motion {
    public enum Duration: Double { case quick = 0.15, standard = 0.25, emphasized = 0.4, linger = 1.0 }
    public enum Distance { static let nudge: CGFloat = 8, shift: CGFloat = 24, shake: CGFloat = 6; static let press = 0.97 }

    /// The animation for a token, or a quick fade or nothing under Reduce Motion.
    public static func animation(_ duration: Duration, exit: Bool = false, reduceMotion: Bool) -> Animation?
    /// A transition that moves by `edge`/`distance` and fades, or only fades under Reduce Motion.
    public static func transition(edge: Edge, distance: CGFloat, reduceMotion: Bool) -> AnyTransition
}
```

- `standard` and `emphasized` map to `.snappy(duration:)`, `exit` to `.easeIn(duration:)`, `linear` to `.linear(duration:)`.
- Views read `@Environment(\.accessibilityReduceMotion)` and pass it in; they never call `withAnimation` or `.animation` with a literal timing. Today's literals (`.easeInOut(duration: 0.2)` in `MoneyFlowView`, `.easeOut(duration: 0.3)` in `InsightsView`, `.snappy(duration: 0.22)` in `Confirmations`, `.snappy` in `ShellFeedback`) move to the tokens.
- Totals use `.contentTransition(.numericText(value:))` with `.monospacedDigit()`; under Reduce Motion, `.contentTransition(.identity)`.
- Rows use the list's own insert and remove animations driven by the token (`.animation(_, value: ids)`); the month slide is `.transition(Motion.transition(edge:...))` on content keyed by the month (`.id(month)`).
- The shake is a `keyframeAnimator` on the refused count, next to the existing `.sensoryFeedback(.error, trigger:)`.
- Charts (Swift Charts, the Sankey shapes) animate through `animatableData` with the `emphasized` token.
- Haptics come from one table in `PennyDesign`, `Motion.Haptic`, with a case per action in [Haptics](#haptics-ios) mapping to its `SensoryFeedback`. Views attach them with `.sensoryFeedback(Motion.Haptic.save.feedback, trigger:)` on the same value that drives the animation, so the haptic and the motion can't drift apart. No view names a `SensoryFeedback` directly. The existing `.sensoryFeedback` calls in `ShellFeedback` and the entry forms move to the table.

### CSS

The tokens join the kit's `--pk-*` tokens in `design-kit/src/styles.css` (and so `apps/web/src/design/tokens.css` through `npm run design:sync`) and `contracts/design-baseline.json` under `tokens.motion`, which `Tokens.swift` mirrors. The existing drift tests (`design:check`, `PennyDesignTests`) then cover motion too.

```css
:root {
  --pk-dur-quick: 150ms;
  --pk-dur-standard: 250ms;
  --pk-dur-emphasized: 400ms;
  --pk-dur-linger: 1000ms;
  --pk-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --pk-ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --pk-nudge: 8px;
  --pk-shift: 24px;
  --pk-shake: 6px;
  --pk-press: 0.97;
  --pk-motion: 1; /* 0 under reduced motion: multiplies every distance */
}

@media (prefers-reduced-motion: reduce) {
  :root { --pk-motion: 0; --pk-dur-standard: 150ms; --pk-dur-emphasized: 150ms; --pk-press: 1; }
}
```

- Every movement is written with the multiplier, for example `translate: 0 calc(var(--pk-nudge) * var(--pk-motion))`, so under reduced motion the same keyframes become a fade at `quick`. Durations come only from the tokens.
- The global clamp in `global.css` (every animation and transition at 0.01 ms) is replaced by these tokens, because it also removes the fades that reduced motion keeps. Rules that have no fade fallback (the shake, the count) check the media query and don't run.
- Today's literals (`0.15s` in `components.css` and `home.css`, the toast's `0.2s ease-out`) move to the tokens.
- Totals count with a small `requestAnimationFrame` tween in a `useCountUp` hook that returns the final value at once when `matchMedia("(prefers-reduced-motion: reduce)")` matches; the visible number is `aria-hidden` during the tween and a visually hidden copy holds the final value.
- Rows animate with CSS (`@starting-style` and `transition-behavior: allow-discrete` for inserts; a fade then a height collapse for deletes). Disclosures use `interpolate-size: allow-keywords` and `::details-content` where the browser has them, and open at once where it doesn't.
- The month slide is a keyframe animation on the content keyed by the month and the direction (`data-direction="earlier|later"`). It doesn't depend on the View Transitions API, so it's the same in every supported browser.
- Charts transition SVG attributes through CSS where they can (`d` on the Sankey bands, `width`/`height` on bars) and with the same tween as totals where they can't.

### Keeping the two in step

[motion/demo.html](motion/demo.html) is the reference for how each moment looks. Each platform's pull request attaches a short recording of its moments next to the demo's. The token values are tested to be the same on both (see below).

## Tests and captures

Motion must never make a test or a capture depend on timing.

- **Card captures and screenshots run with motion off.** The card renderer already turns animation and transitions off (`render.mjs`). The web captures (`cards.real.spec.ts`) already emulate reduced motion and pass `animations: "disabled"`, which finishes CSS animations; the count tween returns the final value under reduced motion, so nothing is left mid-way. On iOS, the cards and `ScreenshotTests` launch with `PENNY_TEST_REDUCE_MOTION=1` and a new `PENNY_TEST_DISABLE_ANIMATIONS=1`, which sets `UIView.setAnimationsEnabled(false)` and `transaction.disablesAnimations` at the root, so nothing is captured mid-way.
- **Journey tests keep motion on**, as a person sees the app, and never wait on it with sleeps: they wait for the element's state (`waitForExistence`, hittable, Playwright's auto-waiting assertions). Because input is never delayed, a test can act on a control as soon as it exists. The iPad smoke test is timed before and after the iOS build step, since a recent CI run hung there; if motion adds more than a few seconds, the smoke run uses `PENNY_TEST_DISABLE_ANIMATIONS` too.
- **Reduced motion is tested on both platforms.**
  - iOS (PennyKit, `ios.sh package-test`): `MotionTests` checks that `Motion.animation` and `Motion.transition` return only a fade or nothing when `reduceMotion` is true, for every token, and that the token values match `contracts/design-baseline.json`. The `reduce-motion` screenshot variant covers the screens.
  - Web (Vitest and Playwright): a unit test for `useCountUp` under reduced motion, and a Playwright test in `shell.spec.ts` that emulates `reducedMotion: "reduce"`, triggers each moment and checks that every running animation from `document.getAnimations()` changes only `opacity` and lasts at most `quick`. The existing "reduced motion removes transitions" test changes to that check.
  - `design:check` and `PennyDesignTests` fail if the motion tokens drift between the kit, the baseline and Swift.
- **Haptics are tested by their table, and felt on a device.** XCUITest and the simulator can't feel a haptic. `MotionTests` checks that every `Motion.Haptic` case maps to the feedback the table above gives, and that the reduce-motion path doesn't remove any. Each iOS build pull request adds a row to the real-device checks in `docs/ios/qa.md`: do every action in the table on an iPhone and feel exactly one haptic of the right kind, and none when a sync from another device arrives.

## Out of scope

- Scroll-driven effects, parallax, and animating the hero glow.
- Transitions between tabs or web routes.
- Custom motion for system components (sheets, pickers, menus, alerts, keyboards).
- Widgets: they keep WidgetKit's default content transitions.

## Build order

After approval, as the issue lists: saving, month and period changes, lists, sheets and disclosures, feedback, navigation. The tokens and the reduced-motion tests come first, with the web part on Linux and the iOS part on the Mac.
