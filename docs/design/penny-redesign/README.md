# Penny — whole-app redesign proposal

Open [the Penpot proposal](https://design.penpot.app/?screen=viewer&file-id=124ca123-b2be-80ce-8008-e92b352e40f9&page-id=818fc2b6-4f0f-80e6-8008-e9306f94bfc1&index=0), [the local visual review and click-through](preview.html), or [the six-screen overview](previews/core-screens.png). The proposal contains **79 screen and state specimens**, 26 reusable component definitions, three system boards, four appearances, an Android specimen, and a desktop overview.

**Status:** the complete revised proposal is available in the local review, SVGs and PNGs. All 79 original screen boards were imported into Penpot. The required Liquid Glass component library and material study are updated there; screen changes are partially synchronized. The Penpot browser connector now times out even on status reads, preventing final native synchronization and verification. This folder does not change the running application.

## Direction

Keep Penny warm, calm and personal. Use a forest summary surface, warm white canvas, restrained terracotta actions, readable secondary text, and a common visual hierarchy. Preserve the existing leaf mark and Ionicons family.

**iOS 26 Liquid Glass is a strict product requirement.** Use floating glass tab navigation, circular glass toolbar controls, glass search and selection controls, and tinted glass primary actions. Keep frequent category choices inline on entry forms and Activity. Open the full category list only when needed.

The material direction follows the user's [YouTube concept reference](https://www.reddit.com/r/iphone/comments/1szx0uz/youtube_app_redesigned_for_ios_26_with_liquid/) and [Apple's material guidance](https://developer.apple.com/design/human-interface-guidelines/materials): glass establishes the navigation and control layer above the financial content. Penpot depicts the static appearance using editable background blur, translucent fills, highlights and shadows. The application must use native iOS 26 Liquid Glass for its dynamic optical and interaction behavior; the Penpot blur values are drawing specifications, not a replacement for the system material. [Expo SDK 57 glass effect documentation](https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/)

Propose DM Sans as one typeface across iOS, Android and web, replacing the current platform-default typography. The font is bundled here under its OFL license for reviewing the proposal; adding it to the application is a separate implementation step. If the product should retain system fonts, keep the scale and weights and adapt metrics to SF Pro and Roboto.

The design deliberately keeps money semantics visible:

- **Recorded cash remaining** is recorded income minus personal-share spending and investment contributions. It is not an account balance.
- **Projected remaining** adds expected recurring income and names that expected amount explicitly.
- Investments are contributions, not portfolio values or returns.
- Activity reports contain recorded entries. Scheduled expense previews do not count as recorded spending.
- Shared expenses retain their original total, payer, and member shares. Personal totals use only the viewer’s share.
- A reimbursement records an existing payment. Penny does not transfer money, and reimbursements do not create additional spending.

## Audit: what changes and why

This is a code and screenshot audit of the current repository, not a usability study. Sources include [AppShell](../../../src/shell/AppShell.tsx), [shared controls](../../../src/shared/ui/index.tsx), [theme palettes](../../../src/shared/theme.ts), all feature screens and forms, [the application guide](../../app-guide.md), and the repository’s [overview](../../screenshots/overview.jpg) and [entry](../../screenshots/add-entry.jpg) screenshots. The existing app was not exercised on a physical device during this proposal.

| Finding in the current app | Proposed change | Where to review |
| --- | --- | --- |
| Phone labels differ from page titles and desktop labels: Entries/Transactions, Shared/Households, Repeat/Recurring, Tags/Categories, Wallet/Accounts. | Use **Home, Activity, Shared, Trips, More** consistently. More contains Recurring, Accounts, Categories and Settings. Keep existing deep links when implementing. | Home, Activity, More, navigation board, desktop |
| On phones, overview stacks four compact totals, calendar, breakdown, and a horizontally scrolling money-flow chart before the entry list. | Lead with recorded and projected money, then recent activity. Place calendar and detailed analysis under **Explore your month**. Use a compact flow summary on phones. | Home, month insights, money flow, calendar |
| Overview’s income can include expected pay. A subtle note carries the distinction between projected money and available recorded money. | Show both recorded and projected figures, with an explicit expected-income amount. | Home and money flow |
| The entry sheet puts date, category, trip and account behind icon-only header controls. Main form content and optional details compete for space. | Retain direct category buttons, with three frequent choices and All categories. Keep date and account labeled. Move split, receipt, recurrence, trip and note into More details. Use a stable bottom save action. | Add expense, income, investment, pickers and more details |
| Recurring cards place edit, pause/resume and remove actions together on each row. | Make each row open schedule details, with one primary edit action, a secondary pause/resume action and a separate removal confirmation. | Recurring, schedule details, removal state |
| Household details combine expenses, balances, recurrence and member management in a long page, with different compact and desktop controls. | Use the same Expenses / Balances / People organization for households and shared trips. Retain monthly reimbursement rules and change history. | Shared money and trip specimens |
| Payment account names can sound like connected financial accounts, while the app tracks labels only. | Show account type and usage, with no implied balances or bank connection. Explain why a linked account cannot be removed. | Accounts and edit-account guard |
| Many controls use local, hardcoded font sizes, radii and spacing. Secondary labels can be very small. | Establish a shared type scale, spacing rhythm and component definitions. Improve muted-text contrast while keeping the original warm direction. | Foundations, components, tokens |
| Glass effects differ by platform and accessibility capabilities. | Make native iOS 26 Liquid Glass the required navigation and control language. Define regular, tinted and selected states, preserving clear financial content underneath. Follow system material accessibility behavior. | Floating tab bars, toolbar controls, actions, search, selection controls and material study |
| Native server setup is necessary, but competes with sign-in content. Server edits are intentionally unavailable while signed in. | Use a compact signed-out server entry point and a clear verification step. Signed-in settings show the server read-only. | Sign-in and server specimens |
| Offline saves, upload failures, stale shared payments and settled-share restrictions need different recovery actions. | Give each state a named message, preserve the draft, explain disabled actions and offer a specific next action. | State specimens and shared-payment notes |

## System rules

The canonical values live in [tokens.json](tokens.json). The canonical layouts and component references live in [scene.json](scene.json), generated from [design.mjs](design.mjs), [flows.mjs](flows.mjs), and [build.mjs](build.mjs).

- Layout: 24px mobile gutters and a 4px base rhythm; most spaces use 8, 12, 16, 20, 24 or 32px.
- Typography: display 40/48, title 30/36, heading 20/26, body 15/21, label 13/18, caption 12/17. Money uses consistent numeric alignment. Smaller navigation and metadata styles have defined roles; they are not used for primary content.
- Controls: 52px primary buttons and inputs, with a minimum 48px interaction target at implementation time. Small glyphs sit inside larger touch areas.
- Shape: 26px capsule actions, 32px floating tab bars, 20px category buttons and cards, 14px fields and 28px sheets. Native iOS materials determine the final optical curvature.
- Color: terracotta identifies primary actions, green income and positive shared balances, blue investments, amber pending states, and red failed or destructive actions. Text and icons always accompany status colors.
- Forms: clear labels and inline category shortcuts; All categories exposes the complete list. Category selection updates in place and keeps the chosen value visible. Optional details are disclosed progressively; keyboard-aware scrolling stays above Save; failed saves retain draft values.
- Navigation: root destinations stay stable. Detail pages show Back and one focused task. The main add action has a stable location; it becomes context-specific within a household or trip.
- Accessibility: support text scaling, visible focus and screen-reader labels, named states, reduced transparency and reduced motion. Touch areas, real keyboard behavior, Dynamic Type and VoiceOver/TalkBack still require device testing during implementation.
- Responsive proposal: one column below 768px; compact navigation rail and two columns from 768–1099px; sidebar and a wider grid at 1100px and above. These breakpoints need validation against the actual app’s device targets.

## Coverage

[screen-inventory.json](screen-inventory.json) lists every specimen, stable identifier, theme, dimensions and behavioral note. The visual review groups them by task:

1. **Daily money:** Home, Activity, type and category filtering, period controls, calendar, category breakdown and money flow.
2. **Entry flows:** expense/income/investment, edit and detail, personal split, category/account/date/trip/repeat pickers, attachment and receipt preview.
3. **Shared money:** household list, expense list, monthly balances, payer and allocations, expense shares, per-share and monthly payment recording, people, invitations, join/create, change history and archive restrictions.
4. **Trips:** personal/shared lists and details, create/edit pattern, sharing a personal trip, participants and monthly balances. Earlier personal expenses remain private when a trip is shared.
5. **Organization:** More, recurring active/paused states, schedule details and editing, accounts and in-use guard, categories and their editor.
6. **Settings and access:** settings, all four appearances, biometric preference and lock gate, locked currency, signed-in server information, signed-out server selection and verification, email sign-in, registration and optional server SSO.
7. **States:** first entry, no matching results, temporary demo, offline save, failed save with retained draft, save feedback, delete/remove confirmation, stale-payment recovery and sign-out.
8. **Themes and platforms:** Dark, AMOLED and Catppuccin applied to Home, an Android specimen, and a desktop overview.

The preview is a **screen storyboard**, not a functioning finance application. Inputs and sample data are static. Some links lead to a representative example of a detail view rather than maintaining the selected record’s state. The expanded save-success screen documents feedback; normal production use should return to the source screen with a toast and haptic. The date specimen specifies the chosen value and recovery behavior, not a replacement for a native OS picker.

The 26 component definitions cover primary/secondary/quiet/destructive/disabled/saving buttons, default/focused/error fields, transaction and menu rows, search, selected/default quick-category buttons, four status badges, five selected navigation states, offline/error banners and a save toast. There are 294 component references in the current screen and system layouts. The native importer creates real Penpot library components and linked instances rather than flattening screens to images.

## Penpot transfer

The proposal uses file `124ca123-b2be-80ce-8008-e92b352e40f9`. The importer requires that design file to be connected through Penpot’s **File → MCP Server → Connect**, using the same account/token as the Codex configuration. Keep the design tab awake while synchronizing. [Official Penpot connection instructions](https://help.penpot.app/mcp/)

Run a read-only check from the repository root:

```sh
node docs/design/penny-redesign/penpot/sync.mjs --probe
```

For a new import, run:

```sh
node docs/design/penny-redesign/penpot/sync.mjs --apply
```

To continue an interrupted import while the same plugin session is connected, use `--apply --resume`. Completed boards are recovered from the plugin cache. A partially created board is reported for repair rather than silently accepted as complete.

The importer reads the existing Penpot URL from the user’s Codex configuration without logging it. It preserves existing pages and creates three named proposal pages:

- `Penny · 00 Start here`: foundations and navigation guidance.
- `Penny · 01 Components`: source icon components, the 26 control components and the specimen board.
- `Penny · 02 Screens & flows`: the 79 screen/state boards and prototype connections.

Colors, spacing, radii, typography and appearance-specific color tokens are created before dependent components. Each appearance has explicitly named color tokens so specimens of several themes can coexist on one page without a global theme switch changing them all. Source Ionicons are imported as editable vectors. All text remains native text. Screen batches and IDs are written to `penpot-state.json` after import phases to support resuming.

The importer uses the official server's `high_level_overview` and `penpot_api_info` documentation. Its native write phases have been exercised against the live file. It preserves SVG outline transparency, scales icon strokes to the actual icon size and applies theme colors to component overrides. Empty labels use a blank-space placeholder because Penpot rejects empty text content. The generated SVG fallback and native layers use the same measured text wrapping.

`node docs/design/penny-redesign/penpot/revise.mjs` applies the Liquid Glass and category revision to the original boards, preserving their IDs and incoming links. It also updates the design-system boards, component sources and typography asset names. Same-screen storyboard controls remain static; selected tabs and category choices do not create redundant navigation to the current board.

Individual [SVG screens](screens/) are also available as an editable vector fallback. They preserve text and paths, but SVG import alone does not establish shared Penpot components or token bindings. Use the native importer for the full deliverable.

## Validation

Current results are recorded in [validation.json](validation.json):

- Application lint and TypeScript checks passed during the proposal work.
- All 79 screen destinations resolve; the generated layout has no declared containment violations.
- The browser loaded the bundled DM Sans font, measured text wrapping and found no text-width overflows.
- The Home → Add expense → Saved click-through passed. This does not exercise every storyboard link or any financial behavior.
- The gallery fits a 390px viewport without document-level horizontal scrolling.
- Forty common text/background pairs and 32 translucent material/background pairs across the four appearances pass a 4.5:1 contrast threshold. This is not an exhaustive accessibility audit of every backdrop, data color, icon or interaction state.
- Thirteen PNG previews cover the core mobile screens, insights, dark variants, desktop, foundations and components. They are review artifacts; they are not embedded in the editable design.
- **Blocked by connector timeouts:** final native revision synchronization and verification. The prior native file had 79 boards, 441 working connections and no file-validation errors. The latest material/category revision remains partially synchronized. Physical-device testing, native screen-reader/keyboard checks and text scaling belong to implementation.

Regenerate the proposal and repeat visual verification:

```sh
node docs/design/penny-redesign/build.mjs
node docs/design/penny-redesign/verify.mjs
```

After native import, run `node docs/design/penny-redesign/penpot/verify-native.mjs` to record native structure and link checks. Export selected native boards with `node docs/design/penny-redesign/penpot/export-previews.mjs add-expense household home-dark desktop`.

Visual verification uses the repository’s existing Playwright dependency. Set `PENNY_DESIGN_CHROME` if the browser executable needs an explicit path. On NixOS the script can discover an installed Google Chrome build; elsewhere it uses Playwright’s installed Chromium.

## Implementation sequence after review

1. Introduce semantic color, type, spacing, radius and material tokens across the four themes. Preserve native iOS 26 Liquid Glass as required. Implement shared buttons, inline category selection, fields and rows.
2. Update the shell and navigation names, then the mobile Home, Activity and entry flow. Keep route wrappers in `src/app/` and non-route UI in feature/shared folders.
3. Apply the same detail and form patterns to households and trips, retaining the existing domain and payment rules.
4. Migrate recurring, accounts, categories, settings, authentication and recovery states.
5. Validate iOS, Android and web, theme parity, larger text, keyboard behavior, receipt handling, app lock, offline drafts and shared-payment race conditions.

No production dependencies, routes, domain logic, database records or application screens were changed for this proposal.

## Asset provenance

- Icons: [Ionicons source](https://github.com/ionic-team/ionicons/tree/main/src/svg), the same icon family used by Penny. [MIT license](assets/IONIC-LICENSE).
- Typography: [Google Fonts DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans). [OFL license](assets/DM-Sans-OFL.txt).
- Receipt and account examples are fictional proposal data. No real user financial data or authentication tokens are included in this folder.
