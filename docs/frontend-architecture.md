# Frontend architecture

Use this formula for new work: **a thin route, a feature screen, local UI state, pure rules, and one shared persistence boundary**.

## Ownership

| Location | Owns | Does not own |
| --- | --- | --- |
| `src/app/` | Expo Router route and layout exports | Components, tests, business logic |
| `src/shell/` | Responsive navigation, account gate, common page chrome and dialog mounting | Ledger mutations or individual screen content |
| `src/features/<feature>/` | Screens, feature components, forms, draft conversion and selectors | Global session lifecycle |
| `src/providers/LedgerProvider.tsx` | Authentication state, ledger snapshot, serialized saves, polling, foreground sync, save feedback | Form inputs, filtering or feature-specific mutations |
| `src/providers/WorkspaceProvider.tsx` | Overview filters and entry-dialog selection that survive navigation | Server data or requests |
| `src/domain/` | Ledger types, money, recurrence and immutable mutation commands | React, Expo, network calls or platform APIs |
| `src/data/` | API requests, revision retries, session credentials and receipt I/O | Presentation or navigation |
| `src/shared/` | UI primitives, formatting and responsive breakpoints | Feature orchestration |

`App.tsx` is a compatibility export. The actual entry point is `expo-router/entry`, with composition in `src/app/_layout.tsx`. The shell renders a visible `Slot`; Overview, Recurring and Categories each render their own content. This follows [Expo Router's layout model](https://docs.expo.dev/router/basics/navigation-layouts/).

Keep platform implementations adjacent: `session.ts` / `session.web.ts`, `receipts.ts` / `receipts.web.ts`, and `PdfPreview.tsx` / `PdfPreview.web.tsx`. Import the extensionless module so Metro chooses the platform. Pure modules used by Node tests or the server use explicit `.ts` imports.

## State and writes

Form fields and validation messages stay in the form. Category editing and schedule deletion confirmations stay in their feature. Entry-dialog selection and overview filters live above the route slot because they must survive navigation. The workspace is remounted for a new session so account changes cannot retain another account's drafts or filters.

Save flow:

```text
Form input → pure draft validation → optional receipt upload
           → domain command → LedgerProvider.commit
                            → latest server ledger + command + revision check
                            → updated snapshot or visible error
```

Commands return `(ledger: Ledger) => Ledger`; they must not mutate the input or perform side effects. The API can replay them after a revision conflict. Generate IDs before constructing a command, preserve unrelated changes, and check edit conflicts against the original entity. A failed save preserves the displayed ledger and the form draft. There is no offline queue.

The session provider rejects overlapping saves, ignores results from an obsolete session, and cleans up timers and foreground listeners. Demo changes use the same commands locally. Do not add polling or direct ledger writes to screens.

Overview selectors calculate monthly totals independently of the visible list's search/day/kind filters. Reports use integer-cent personal shares. Presentation components receive explicit props; they do not fetch data. Screen-local styles live with their components; reusable controls and tokens live in `shared/ui`.

## Adding a feature

1. Add its screen under `src/features/<name>/` and a route export under `src/app/`.
2. Keep transient state local. Put state in a provider only when its lifetime must span routes or sessions.
3. Extract calculations and input conversion into pure functions. Add reusable ledger mutations to `domain/commands.ts` and run them through `commit`.
4. Break substantial screen sections into components with named props. Extract shared components after there is real reuse, rather than creating generic frameworks in advance.
5. Put behavior tests beside the feature in `__tests__/`. Keep Node domain/API integration tests under `tests/`. Never put tests in `src/app/`.

ESLint rejects upward dependencies from domain, data, shared code and providers into screen/composition code. A feature may reuse an explicit component from another feature (for example, entries use receipt preview); avoid a global feature barrel or feature-to-feature state dependencies.

## Testing

```sh
npm run test:core      # Node: money, recurrence, commands, draft conversion, selectors, real API integration
npm run test:ui        # Jest/Expo: iOS, Android, and web projects
npm run test:ui:ios    # iOS native component interactions
npm run test:ui:android # Android native component interactions
npm run test:ui:watch  # Interactive frontend work
npm test              # Both suites; also used by CI
npm run lint
npm run typecheck
npm run build:web
npx expo export --platform ios --platform android --output-dir /tmp/penny-native-export
```

The frontend harness uses the SDK-matched [Jest Expo preset](https://docs.expo.dev/develop/unit-testing/), React Native Testing Library and [Expo Router's testing utilities](https://docs.expo.dev/router/reference/testing/). The same native interaction tests run with the iOS and Android presets so platform-specific module resolution and picker behavior are checked on both. Tests press accessible controls and assert observable outcomes, rather than snapshots of the component tree. The separate web project runs `*.web.test.jsx` with React DOM and real React Native Web components, including SVGs and modal portals; it catches rendering errors that native mocks can miss. Run it alone with `npm run test:ui -- --selectProjects web`.

Web tests use `tests/web-renderer.jsx`, which fails on any `console.error` or `console.warn`, including during unmount. Do not silence these messages in individual tests. Test both empty and populated states: the empty chart does not mount an SVG, so it cannot catch SVG prop incompatibilities. Chart cases cover split expenses without income, income only, mixed income/expenses, overspending, break-even and label selection. Workflow cases cover desktop/phone overview filters and editing, form validation and failed-save retries, category CRUD, schedule pause/resume/removal, authentication, currency changes and receipt failure handling.

Conditional children of a `View` must use boolean conditions or return `null`. For string state, use `message !== "" && <Text>…</Text>` or a ternary; `message && …` passes an empty string to the view and triggers a React Native Web text-node error.

Native-only props must not leak onto DOM elements through third-party components. The decorative chart SVG uses `accessible={false}` on native and `aria-hidden`/`tabIndex` on web. Use `style.pointerEvents` rather than the deprecated web `pointerEvents` prop.

Cover success and failure where behavior can lose user work: stale edit/delete conflicts, retries, duplicate submissions, failed-save draft retention, session changes, subscription cleanup and navigation persistence. Domain tests cover money/date boundaries and immutability. Route tests use the real route exports, shell, screens and providers with a mocked API.

Native font loading is mocked globally; receipt I/O and preview are mocked in native form/navigation tests. Web receipt tests render the real preview UI with mocked file I/O and PDF worker results to check loading, errors, pagination, download links and resource cleanup. These tests do not validate device pickers, actual PDF decoding, keyboard behavior, accessibility on a device or visual layout. Bundle exports check cross-platform resolution, not device interaction. Changes to those areas still need a browser or simulator/device check. The server integration test requires permission to listen on a local port.

### Verification on September 27, 2026

- Passed 26 core tests, 16 native UI tests and 22 real-DOM web tests, plus lint and TypeScript checks.
- Exported web, iOS and Android bundles successfully.
- Used temporary demo data in a live development browser at desktop and 390-pixel phone widths. Verified chart selection, a $98 expense with a $49 personal share, monthly recurrence, pause/resume, category creation, settings, search, phone-width editing/saving and empty-month navigation.
- No browser console warnings or errors appeared after a clean reload and those interactions. The phone document width matched its viewport (390 pixels).
- No physical-device/simulator run or real receipt upload/PDF decoding was performed in this pass.
