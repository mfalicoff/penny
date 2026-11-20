# design-sync notes: Penny iOS kit

- **Source:** `design-kit/` (`@penny/ios-kit`) is a web reference kit built from the redesign proposal in `docs/design/penny-ios/`. The React Native app does not use it. Build it with `cd design-kit && npm ci && npm run build` (esbuild bundle + `tsc` declarations + copies `src/styles.css` and `fonts/` into `dist/`).
- **Converter invocation** (repo root): `--node-modules ./design-kit/node_modules --entry ./design-kit/dist/index.js --out ./ds-bundle`. The package dir resolves to `design-kit/`, so `cssEntry` and the docs paths are relative to it.
- **Components:** all components live in six grouped files (`src/components/{foundation,controls,lists,money,chrome,web}.tsx`), so `componentSrcMap` pins every component's file. When you add a component, add it there too.
- **Groups:** each component's group comes from the `category` frontmatter in `design-kit/docs/<Name>.md`. Those docs are also the `.prompt.md` bodies, so each one carries the rules and an example. A new component needs a doc, or it lands in "general".
- **Font:** Inter (OFL, `design-kit/fonts/`) is the primary family in `--pk-font`, so designs render identically everywhere. The native app uses SF Pro. "SF Pro Text" was removed from the font stack because it caused `[FONT_MISSING]` (SF Pro can't be shipped).
- **Icons:** `src/icons.ts` is generated from `docs/design/penny-ios/assets/icons.js` (Ionicons, MIT). To add an icon, regenerate it from that file.
- **Previews:** `previews/*.tsx` wrap glass components in a copper-glow backdrop, because glass on a flat background reads as plain white.
- **Card layout:** most previews are phone width (402px), so `overrides.<Name>.cardMode = "column"`. `Screen` and `Sidebar` use `single` with a viewport. Changing overrides requires a full `package-build.mjs` (`[CONFIG_STALE]` otherwise).
- **Browser:** the machine has no system Chrome (NixOS). Use `DS_CHROMIUM_PATH=$(nix build nixpkgs#chromium --no-link --print-out-paths)/bin/chromium`. Playwright is importable; its downloaded browsers don't run on NixOS.

- **Web shell:** `web.tsx` holds the desktop components (WebFrame, WebSidebar, TopBar, WebButton, SearchField, DataTable, Dialog, Kbd). `TopBar` previews are page-width, so its card is `single` with all variants stacked in one export.
- **CSS gotcha:** scope descendant selectors with `>` when a component contains `Icon`. A bare `.pk-month span` rule once padded the icon span to zero width and hid the chevrons.
- **Branch:** this work targets `v2`, where the native app is SwiftUI (`apps/ios`) and the web app is React (`apps/web`). `contracts/design-baseline.json` traces these cards and the kit (MAZ-132); its tests check card and doc hashes, so update it with any card or component change.

## Known render warns
- None open. All 34 components render cleanly with authored previews graded good.

## Pending sync
- **Hero glow contrast (MAZ-183, decided in MAZ-180):** the light `--label-2` is now #57524D (was #6F6A64) in `penny.css` and `design-kit/src/styles.css`; the `empty-home` card's "$0" and the `ipad/trip` card's phase use `--label-2`. Push the kit and those two cards to the Claude Design project at the next re-sync.
- **Emailed receipts (MAZ-184):** the 21 `receipt-*` cards in `docs/design/penny-ios/{iphone,ipad,web}` were added without a kit change (they reuse `penny.css`, `ipad.css`, `web.css` and existing icons) and are not yet in the Claude Design project. Import them at the next re-sync. The web cards add the sidebar's "Receipts to attach" item in their own script, so `assets/web.js` and the other web cards are unchanged.
- **Shared schedule on Recurring (MAZ-219):** `iphone/recurring.html` shows Streaming as a shared schedule (Shared tag beside the title, the household's name on its own line, "your share" under the amount) and its footer adds a sentence about shared schedules. No kit change. Push the card at the next re-sync.
- **Sidebar All households and trip rows (MAZ-240):** the web sidebar (`assets/web.js`, so every web card with a sidebar) adds All households after the households; the iPad cards with a sidebar (`home`, `activity`, `shared`, `trip`, `settings` and the four `receipt-*` cards that draw it) add All households, show a trip with its start date ("Lisbon Nov 12" instead of "Lisbon trip 3") and add All trips. The kit's `WebSidebar` doc describes the rows; the component is unchanged. Push the cards and the doc at the next re-sync.

## Re-sync risks
- **Do the whole re-sync in one change:** after a card or kit change, re-render the baselines (`node docs/design/penny-ios/render.mjs 2`), update the hashes in `contracts/design-baseline.json`, re-sync this project, and update the affected verdicts in `contracts/visual-comparisons.json`. The steps are in [visual acceptance](../docs/design/visual-acceptance.md#re-sync-after-a-design-change); `npm run test:core` and the web workflow fail on a stale baseline or hash.
- **Token drift:** the kit's tokens and CSS are copied by hand from `docs/design/penny-ios/assets/penny.css`. When the proposal's colors or category palette change, update `design-kit/src/styles.css` too, or the two drift apart silently.
- **Sankey logic:** `MoneyFlow` copies the rules of `apps/web/src/domain/selectors/moneyFlow.ts` (top five plus "N more", Beyond income, Left over). Changes to the app's flow logic won't reach the kit automatically.
- **Hand-maintained mirrors:** `conventions.md` and `docs/*.md` repeat these rules in prose. Re-validate names against the build on every sync.
- **Toolchain pins:** esbuild 0.25 and TypeScript 5.9, recorded in `design-kit/package-lock.json`.
