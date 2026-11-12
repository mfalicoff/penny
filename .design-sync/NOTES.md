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

## Re-sync risks
- **Token drift:** the kit's tokens and CSS are copied by hand from `docs/design/penny-ios/assets/penny.css`. When the proposal's colors or category palette change, update `design-kit/src/styles.css` too, or the two drift apart silently.
- **Sankey logic:** `MoneyFlow` copies the rules of `src/domain/selectors/moneyFlow.ts` (top five plus "N more", Beyond income, Left over). Changes to the app's flow logic won't reach the kit automatically.
- **Hand-maintained mirrors:** `conventions.md` and `docs/*.md` repeat these rules in prose. Re-validate names against the build on every sync.
- **Toolchain pins:** esbuild 0.25 and TypeScript 5.9, recorded in `design-kit/package-lock.json`.
