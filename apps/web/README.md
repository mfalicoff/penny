# Penny web app (v2)

The browser client for Penny v2: React and TypeScript on Vite, with [TanStack Router](https://tanstack.com/router/latest/docs/framework/react/overview) for typed routes and [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) for server state. It calls the .NET API on its own origin and has no server of its own. MAZ-83 sets up the foundation. Product screens arrive with MAZ-84 onward, and the legacy Expo web app in `src/` keeps running until cutover.

## Stack and pinned versions

All versions are exact in `package.json` and locked in `package-lock.json`.

| Concern | Choice | Version | Why |
| --- | --- | --- | --- |
| UI | React, React DOM | 19.3.1 | Browser-native DOM. No React Native or react-native-web. |
| Build and dev server | Vite, `@vitejs/plugin-react` | 8.3.7, 6.3.0 | Static output for the existing nginx front end, plus a dev proxy to the real API |
| Routing | `@tanstack/react-router`, `@tanstack/router-plugin` | 1.170.46, 1.169.0 | File routes, generated route tree, typed links and validated search parameters |
| Server state | `@tanstack/react-query` | 5.107.1 | Caching, retries, refetch on focus, and loaders that share one cache |
| Validation | Zod | 4.6.7 | Response and search-parameter schemas |
| Types and lint | TypeScript, typescript-eslint, ESLint | 6.0.3, 8.72.2, 10.14.0 | typescript-eslint supports TypeScript below 6.1, so this app stays on 6.0 until it supports 7. |
| Tests | Vitest, jsdom, Testing Library | 5.1.0, 31.0.0, 16.3.3 | Component tests against the real router and query client |
| Browser smoke | Playwright | 1.64.1 | Runs the production build in Chromium (desktop and phone) |

**TanStack Start isn't used.** Every business endpoint already lives in the .NET API, and nginx already serves static files with a same-origin `/api/` proxy (`deploy/web`). Server rendering would add a Node runtime to deploy and secure, and nothing needs it yet: the app sits behind sign-in, so SEO doesn't apply, and first paint is a small static shell. Reconsider only if a documented rendering or hosting need comes up.

## Developer setup

Requirements: Node 24 (from the repository's Nix shell or your own install). The web app has its own `package.json` and lockfile, so installing it never changes the Expo app's dependencies.

```sh
cd apps/web
npm ci
npm run dev           # http://localhost:4173
```

The dev server forwards `/api/` to `PENNY_API_URL`, which defaults to `http://127.0.0.1:8080`. Vite reads that variable on the Node side, so it never reaches the browser bundle. To work against a disposable real backend (PostgreSQL 18 plus the .NET API, see [test environment](../../docs/migration/test-environment.md)):

```sh
# From the repository root: start the stack and note the API URL it prints.
npm run test-env -- up --seed searchable-household
# Then, in apps/web:
PENNY_API_URL=http://127.0.0.1:<port> npm run dev
```

The proxy keeps the browser's `Origin` (`http://localhost:4173`), and port 4173 is one of the test environment's default allowed origins. With a hand-run API, add the origin to `Auth__AllowedOrigins`. The legacy Expo Playwright suite also uses 4173, so don't run both at once.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload and route generation |
| `npm run lint` | ESLint with type-aware typescript-eslint, TanStack Router and Query, and React Hooks rules, zero warnings |
| `npm run typecheck` | `tsc -b` over app, test and Node configs |
| `npm test` | Vitest unit and component tests. Any console error or warning fails the test. |
| `npm run build` | Production build into `dist/`, then `scripts/verify-dist.ts` |
| `npm run test:e2e` | Playwright smoke against `vite preview` on port 4175, with `/api` mocked |
| `npm run design:sync` / `design:check` | Regenerate the design tokens, or check that they match the design kit |
| `npm run check` | Everything above except the browser smoke |

On NixOS, Playwright's downloaded browsers can't run. Use a system Chromium instead: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=$(nix shell nixpkgs#chromium -c sh -c 'readlink -f $(which chromium)') npm run test:e2e`.

## Repository layout

```
apps/web/
  index.html             entry document (light and dark theme-color)
  public/favicon.svg     leaf mark from the design kit's Ionicons set
  src/
    main.tsx             applies saved appearance, creates the QueryClient and router, renders <App>
    app/                 App providers, router factory, query client, appearance preferences
    app/shell/           the signed-in shell: sidebar, top bar, tab bar, drawer, shortcuts, page titles
    api/                 apiFetch (and its swappable transport), ApiError, DTO schemas, query keys, one module per resource
    auth/                session lifecycle, SSO popup flow, pending-change registry, AuthGate
    demo/                the temporary demo: in-memory API stand-in and its start/leave lifecycle
    offline/             the durable offline ledger (MAZ-87): IndexedDB store, sync engine, legacy import, sync banner
    features/            screens by feature (auth, search, settings, home, entries, households, recurring, placeholders), outside src/routes/
    design/              tokens.css (generated), CSS, Icon, controls, dialogs, Money, loading/empty/error/toast states
    routes/              file routes only. Every file here is a route.
    routeTree.gen.ts     generated by the router plugin and committed
  tests/                 shared test setup and helpers, app-level route tests, script tests
  e2e/                   Playwright smoke of the production build
  scripts/               design-token sync and dist verification (TypeScript, run by Node 24)
```

**Package boundaries.** The web app depends on the design kit only through `@design-kit/*`, which aliases the repository's `design-kit/`. It never imports the kit's React components, which are a reference kit for Claude Design. It takes three things from the kit:

- **Tokens.** `--pk-*` custom properties from `design-kit/src/styles.css`. `npm run design:sync` writes them to `src/design/tokens.css`, mapping the kit's light block to `:root` and its `.pk-dark` block to `prefers-color-scheme: dark`. Light and dark follow the system by default, per MAZ-132; Settings › Appearance can pin one with `<html data-theme>`, which the generated file also handles. CI fails if the file drifts.
- **Font.** Inter (`design-kit/fonts/Inter.ttf`), fingerprinted into `dist/assets/`. Its OFL license is emitted to `dist/licenses/Inter-OFL.txt`.
- **Icons.** Ionicons v7 outline glyphs (`design-kit/src/icons.ts`, MIT, notice at `dist/licenses/Ionicons-MIT.txt`), rendered by `src/design/Icon.tsx`. Icons are decorative unless given a `label`.

The visual baseline is `docs/design/penny-ios` and `contracts/design-baseline.json`. The visual comparison of this implementation with the cards belongs to MAZ-122.

**Shared rules.** Ledger merge, recurrence, commands and local search come from the repository's platform-neutral `src/domain/` ([domain rules](../../docs/migration/domain-rules.md)) through the `@domain/*` alias (Vite `resolve.alias` and `paths` in `tsconfig.app.json`/`tsconfig.test.json`). Import them, never copy them; the module compiles under this app's stricter flags.

## Design system and accessibility

MAZ-85 ports the kit's look onto native, accessible elements. Use these instead of new one-off markup:

| Need | Use | Notes |
| --- | --- | --- |
| Button | `Button` (`src/design/controls.tsx`) | Variants `primary` (one per page), `secondary`, `quiet`, `danger`, `danger-quiet`. `busy` keeps it focusable and ignores presses. 36px for mouse and keyboard, 44px on touch screens (`pointer: coarse`). |
| One choice of a few | `ChoiceGroup` | Native radios in a `fieldset`, so arrow keys and "1 of 3" work. Appearances: `segmented`, `cards`, `list`. |
| On/off setting | `SwitchRow` | `<input type="checkbox" role="switch">` with a label and an announced description. |
| Dialog | `Dialog` / `ModalDialog` (`src/design/ModalDialog.tsx`) | Portal, the rest of the page `inert`, Tab trapped, Escape and the scrim close it, focus moves in on open and back to the opener on close. |
| Panel | `Card` | A labelled `section`. Money lives on solid surfaces, never glass. |
| Money | `Money`, `formatCents` | Integer cents, tabular figures. Expenses use the label color; income, investment and pending add their color **and** a visually hidden word. No currency means a plain number, never an assumed symbol. |
| Status label | `Badge` | Always text, optionally with an icon. |
| States | `LoadingState`, `EmptyState`, `ErrorState` (`src/design/states.tsx`) | Errors are `role="alert"`, say nothing was lost, and offer Try again. |
| Feedback | `Banner`, `OfflineBanner`, `ServerUnreachableBanner`, `SaveErrorBanner`, `useToast()` | Specimens `offline`, `save-error`, `saved-toast`. A save error keeps the draft and names the next step. Toasts are polite live announcements, last 6 seconds, pause under the pointer or focus, and can offer Undo. |

Conventions:

- Every page has one `<h1>`, rendered by the shell from the route's `staticData.title`; it also sets `document.title` ("Trips · Penny"). A page whose title depends on data calls `usePageTitle()` (`src/app/shell/pageTitle.ts`). Sections inside a page use `<h2>`.
- Landmarks: skip link, `aside` with the "Main" navigation, `header`, `main#main`, and a "Tabs" navigation on phones.
- Focus is always visible (`:focus-visible`, copper outline). Dialogs and the drawer restore focus to whatever opened them.
- Meaning is never color alone: badges and money tones carry text.
- Glass (`.glass`) is for the control layer only (tab bar, banners over content, toasts). Reduce transparency, from Settings (`data-transparency="reduced"`) or the system (`prefers-reduced-transparency`), makes it opaque. Forced-colors mode draws system borders. Reduced motion turns transitions and animations off globally. Write `backdrop-filter` unprefixed: the build adds the WebKit prefix, and hand-writing both made the minifier drop the standard one.
- Native iOS 26 Liquid Glass is a native requirement only; nothing on the web depends on the material.

## Shell, navigation and keyboard

`src/app/shell/AppShell.tsx` renders the signed-in app. Navigation is defined once in `navigation.ts`: Home, Activity, Insights; Together (Shared, Trips); Manage (Recurring, Accounts, Categories); Settings in the account footer.

| Shortcut | Action |
| --- | --- |
| ⌘K or Ctrl+K, `/` | Focus search (on Activity, its own field) |
| N | Add entry |
| G then H, A, I, S, T, R | Home, Activity, Insights, Shared, Trips, Recurring |
| Esc | Close the dialog or drawer |

Shortcuts never fire while typing in a field, while a dialog is open, or with Alt/Ctrl/⌘ held (except ⌘K). Each has a visible control and `aria-keyshortcuts`.

Add entry opens a dialog over the current page (the web card `web-add-entry`); `/entries/new` opens it over Home and returns to `/` when closed. The form itself is MAZ-88, so the dialog says the browser can't add entries yet.

### Responsive layout

| Width | Layout |
| --- | --- |
| < 768px | Compact top bar (logo, title, round +), bottom glass tab bar with Home, Activity, Shared, Trips and More. More opens the full navigation as a modal drawer. Settings sections are separate pages with an "All settings" link. |
| 768–1099px | Icon rail (labels stay in the accessibility tree), top bar with search and Add entry, two-pane Settings. |
| ≥ 1100px | Full 248px sidebar with section headings and shortcut hints. |

768 and 1100 come from the design proposal. They were checked against real content rather than taken as fixed: the top bar's search and Add entry need about 700px beside a title, and the sidebar's labels and shortcut chips need the full 248px, which leaves under 850px for content below 1100. Playwright (`e2e/shell.spec.ts`) loads every page at 320, 390, 768, 1024, 1100 and 1440px, at 640px (a 1280px window at 200% zoom) and with doubled root text, with a very long account email, and fails on any horizontal scrolling. Move a breakpoint only with those checks.

## Routes and search state

Every legacy URL opens (`tests/shell.test.tsx`): `/`, `/transactions`, `/entries/new`, `/insights`, `/households`, `/households/$id`, `/households/$id/expenses/$expenseId`, `/trips`, `/trips/$id`, `/recurring`, `/accounts`, `/categories`, `/settings` and `/settings/{appearance,currency,server}`. Screens that belong to MAZ-88, 89, 92 and 93 show `NotYetAvailable`, which names the page and links Home, instead of "not found"; replace it in the feature issue (the household screens arrived with MAZ-91 and recurring schedules with MAZ-90, below). Filters live in validated search parameters (`/transactions?q=…&month=…`, `/households/$id?month=…&tab=…`), so a filtered view can be bookmarked, shared and restored with Back and Forward; dialogs, drawers and toasts are not in the URL.

## Shared households (MAZ-91)

Code: `src/api/households.ts` (query options, writes, invalidation), the household DTO models in `src/api/schemas.ts`, `src/features/households/` (screens, the split preview and labels in `model.ts`, error wording in `errors.ts`) and `src/design/shared.css`. Cards: `iphone-shared-list`, `iphone-shared`, `iphone-shared-balances`, `iphone-shared-people`, `iphone-shared-expense-add`, `iphone-split`, `iphone-record-payment`, `iphone-payment-stale`, `iphone-household-create`, `iphone-history`, `ipad-shared` and `web-household`.

| URL | Screen |
| --- | --- |
| `/households` | Households and shared trips you belong to, with this month's balance ("you're owed", "you owe", "settled") and an Overdue badge, plus **Join with a code** and **New household** (one dialog with Create and Join). |
| `/households/$id` | Members and your balance for the month, a month switcher (`?month=YYYY-MM`), and the sections **Expenses**, **Balances** and **People** (`?tab=balances`, `?tab=people`), plus **History** (`?tab=history`). The legacy `?add=1` opens the new-expense form once and is then removed from the URL. |
| `/households/$id/expenses/$expenseId` | The same page with the expense in a detail panel: original total, payer, your share ("in your spending"), every share with its repayment status, change history, Mark as paid, Edit and Delete for everyone. |

Behavior:

- **Online only.** Shared data lives on the server and never in the browser's offline store (MAZ-87 owns personal offline edits). Every write goes straight to the API. A failure leaves the form open with what was typed and names the next step; offline and unreachable failures say nothing was sent and offer Retry. While the browser is offline the shared pages say that changes can't be sent until it's back.
- **Server rules, previewed.** The form previews the split (equal, exact amounts or percentages, with remainder cents assigned like the server's `HouseholdSplits`) and checks that shares add up before sending, but the server computes and stores the shares. The preview is tested against the golden `contracts/fixtures/shared-splits.json` cases. Participants are the members active on the expense date (every current member on a shared trip); a paid expense keeps its participants and locks payer, total, month and shares.
- **Query use after writes.** Balances, suggestions, overdue months and audit are derived on the server, so a successful write never patches the cache: `refreshHousehold` invalidates the household's queries (detail, months, expenses, audit, rules), the household list and search, and only what is on screen refetches. Leaving and archiving drop the household's cache (`forgetHousehold`). Failed writes refetch only what the failure made stale.
- **Revisions and conflicts.** A stale expense or rule edit (`409 … changed`) re-reads the latest version and shows it next to the kept draft: **Keep my changes** saves the draft on top of the new revision, **Use their version** takes theirs. A share payment carries the revision the person saw; if the expense changed meanwhile (seen in the cache or refused by the server) the payment-changed state shows the old and new totals and shares, says nothing was recorded and offers only **Review expense**, which returns focus to the refreshed expense. A monthly payment that is no longer the full suggestion re-reads the month and shows the old amount and what is owed now; if that re-read fails too, the dialog stays open, says the balance changed, nothing was recorded and why the new amount couldn't load, and trying again re-reads it.
- **Payments document transfers.** Recording a share or a monthly payment notes money that already changed hands outside Penny; the dialogs say Penny doesn't send money and nobody's spending changes. Monthly payments are offered from the month's last day (UTC, as the server's cutoff) to the two people involved; earlier, Balances says when they open and points to Mark as paid for a single expense. Once a month has a monthly payment, share payments close for it.
- **Membership.** `/me` knows only the email, so the viewer's member id is found by email in the member list. Only the creator invites (a 10-minute code with a live countdown, Copy, and a new code when it expires), renames, removes members and archives; the creator can leave once alone. Leaving, removal and archiving need every month settled; the archive dialog lists unsettled months it can see, and the server's refusal is shown in the dialog. A `404 Household not found.` from a write means membership changed elsewhere. Former members and archived households are read-only (archived households drop out of `GET /api/households`, which is how the page tells).
- **Privacy.** The payer's account list is offered only when the viewer is the payer, with "only you see which account you paid from". Other members see that the account stays private; the server never sends it to them, and the audit view never reads it.
- **Accounts and categories from this browser's ledger.** The form's categories and accounts (and the detail panel's account name) come from the durable offline ledger (`useLedgerChoices`, `src/features/households/choices.ts`), so ones created on this device and not yet synced are included; the server copy in Query is the fallback (the demo, or before the offline ledger loads). Categories are sent by value, so an unsynced one is used at once. An account is sent by id and the server checks it against its copy of the payer's ledger (`400 Payment account not found.`), so an account that copy doesn't have yet is listed as "(waiting to sync)", can't be chosen, and the hint says it can be once it has synced. The form doesn't sync first and submit: shared writes stay online-only and separate from personal offline work.
- **Recurring.** Choosing Repeat on a new expense creates a shared rule (weekly, monthly or yearly from the chosen date). Repeating expenses are listed beside the month with Edit, Pause/Resume and Remove; the server records each occurrence on its date with that day's members.

Not in this issue: moving an expense to another household, receipt upload and preview (MAZ-94; an existing receipt opens from the detail panel), shared trip editing and the trip screens (MAZ-93), shared rows in Activity and Home (MAZ-88/92), and push. The temporary demo has no households, so `/households` says the server doesn't offer them there.

## Recurring schedules (MAZ-90)

Code: `src/features/recurring/` (the page, the detail and remove dialogs, the form, and `model.ts` for labels, upcoming dates and the draft), `src/design/recurring.css`, and the browser merge in `src/offline/merge.ts`. Cards: `iphone-recurring`, `iphone-schedule-detail`; specimens `recurring`, `recurring-paused`, `schedule`, `edit-schedule`, `remove-schedule`.

| Where | What |
| --- | --- |
| `/recurring` | Schedules grouped as Income, Expenses and Investments: active ones by next date, then paused ones. Each row shows the cadence, next date (or Paused), account, amount, and **Waiting to sync** until the server has the change. **New schedule** opens the form. Empty: "Rent, payday, the usuals." |
| Row › detail dialog | Amount, cadence ("Every month on the 31st (the last day in shorter months)"), Active or Paused, **Edit**, a separate **Pause**/**Resume**, the next three dates, category, account, your share, start date, how many entries it has recorded, the note, and **Remove schedule**. |
| Remove schedule | A separate confirmation: Penny stops recording it, entries it already recorded stay. **Keep schedule** returns to the detail; after removing, focus moves to New schedule (the row is gone). |
| New / Edit schedule | Type (expense, income, investment), amount, name, Repeats (weekly, monthly, yearly), first or next date, category of that type, optional account, your share for expenses (all, split equally, an amount, a percentage) and a note. A live line shows what saving does: the next dates, the last-day fallback for days after the 28th, and the entries a backdated start records at once. Edit and Cancel return to the detail. |

Rules:

- **Personal and offline first.** Schedules are part of the personal ledger, so every change is saved to this browser's durable store (`useLedgerEngine().save`) and syncs from there ([browser offline sync](../../docs/web-offline-sync.md)). A save made offline or with the server down says "Saved on this device. It syncs when you're back online." and the row shows Waiting to sync. A refused save (storage blocked or full, signing out, a rule check such as a removed category or account) keeps the form open with the draft and the reason. The demo stores nothing, so it shows its sample schedules read-only.
- **Occurrences versus the schedule.** A schedule records an entry on each date with the id `{scheduleId}:{date}` (the shared `materialize`), so no device records a date twice. Editing a schedule changes future dates only; entries it already recorded keep their details and are edited as entries (MAZ-88). Removing a schedule keeps its entries. Pausing records nothing; resuming continues on the first date after today, skipping the paused dates (the shared `setScheduleActive`).
- **Anchor day and catch-up.** A new schedule is anchored on its first date's day; moving the next date re-anchors it, keeping it keeps the anchor (a schedule on the 31st stays on the 31st after a 30-day month or February, leap years included). A first date in the past records every missed date at once when it is saved; an edited next date must be today or later. Due dates are caught up once on load, on save, on tab focus after midnight and after each sync. Unlike the legacy form, creating a schedule doesn't also add a separate entry for the first date (it is the first occurrence, with the occurrence id), and no future-dated entry is created.
- **Time zone.** Dates are calendar days in the browser's local time zone, as in the native and legacy apps (personal recurrence runs on the client; shared household rules run on the server in UTC). A browser in a different time zone may record a date a few hours earlier or later than another device; the occurrence id still prevents a duplicate.
- **Conflicts.** If the schedule changes in another tab or on another device while its form is open, the form says so, keeps the draft and offers **Keep my changes** or **Use the latest**; a stale save is refused by the shared `saveSchedule`. A schedule removed elsewhere shows as removed. A schedule deleted on another device is never brought back by this browser's offline catch-up ([recurrence refinements](../../docs/web-offline-sync.md#conflict-policy)).

Tests: `tests/recurring-model.test.ts` (cadence labels, every frequency through short months and leap years, resume skipping paused dates, catch-up dates, validation, anchoring on edit, removal keeping entries), `tests/recurring.test.tsx` (the real app over fake-indexeddb: grouped list, empty state, a backdated schedule, detail, pause and resume, edit, remove with focus recovery, offline save and one sync, an edit racing another device, blocked storage keeping the draft), `tests/offline/merge.test.ts` and `e2e/recurring.spec.ts` (desktop and phone: all frequencies, the 31st and Feb 29, edit, pause/resume, remove, an offline save through a reload with one PUT and no duplicate entries, and a schedule deleted on another device after an offline catch-up staying deleted). Not covered: the real .NET/PostgreSQL journey (MAZ-95) and screenshot comparison (MAZ-96/122).

## Settings

| Section | What it does |
| --- | --- |
| Account (`/settings`) | Email, and sign-out with its confirmation (moved here from the shell). In the demo: Leave demo. |
| Appearance | Light, Dark or System, and Reduce transparency. Stored per browser in `localStorage["penny.preferences"]` (`src/app/preferences.ts`), applied before first paint, kept after sign-out, synced across tabs. A saved legacy `amoled` or `catppuccin` theme becomes Dark. |
| Currency | The ledger currency. It can change only while the ledger has no entries or recurring rules, as in the legacy app, and the reason is shown; if the server doesn't send those lists it stays fixed rather than guessing. Saving writes the snapshot back with its `revision`: a 409 reloads and asks again, other failures keep the choice and offer Retry, success shows a toast with Undo. Shared households keep their own currency. |
| Server | The page's own origin and the server version, read-only: the web always uses the server it was opened from. |

The native-only settings (app lock, server picker, notifications) are omitted; the web card's "Show cents", "Week starts on" and "Export data" wait for the screens that use them.

## Temporary demo

"Explore a demo" on the sign-in screen runs Penny on sample data without an account (`src/demo/`). It replaces `apiFetch`'s transport with an in-memory stand-in for the endpoints the web uses (session, ledger read and revision-checked write, search with cursor paging); other endpoints answer 404, so a screen that needs a real server says so. It is isolated and temporary: no request reaches the API (Playwright checks this), it runs as `demo@penny.invalid` so its cache keys can't match a real account, nothing is stored, and Leave demo or a reload ends it and drops its cache. It can't be started while signed in. Limitations: it only covers search and currency (not shared households); the sample data is made up and fixed to the current month.

## Route conventions

- Routes are files in `src/routes/`, following [file-based routing](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing). The plugin regenerates `src/routeTree.gen.ts` on `dev` and `build`. Commit it, because CI fails if it's stale. Files that start with `-` or contain `.test.` are not routes. Put components, hooks and helpers outside `src/routes/`.
- Keep the legacy URLs: `/`, `/transactions`, `/entries/new`, `/accounts`, `/categories`, `/recurring`, `/households/$id`, `/trips/$id` and `/auth/callback` (see [redesign.md](../../docs/migration/redesign.md#legacy-deep-links)). Details and pickers are dialogs or panels, not new public URLs.
- Validate search parameters with a Zod schema in `validateSearch` ([search params guide](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)). Add `.catch()` to each field so old or hand-edited links fall back instead of failing. Read them with `Route.useSearch()`, and update them with `navigate({ search: (prev) => … })`.
- Navigate with `<Link to>`, which is typed against the route tree. The router is registered globally in `src/app/router.tsx`, so a bad path or search parameter doesn't compile.
- The root route supplies `{ queryClient }` as router context. Loaders that need data call `context.queryClient.ensureQueryData(options)`, so the router never keeps a second cache (`defaultPreloadStaleTime: 0`). See [external data loading](https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading).

## Data conventions

- Every request goes through `apiFetch(path, schema, init)` in `src/api/client.ts`. Paths must start with `/api/`. Requests are same-origin with `credentials: "same-origin"`, so the session cookie is never sent to another origin. Responses are validated with Zod before use. Failures throw `ApiError` with the HTTP status (0 when the server couldn't be reached) and the API's `{ error }` message.
- Each resource module exports [`queryOptions`](https://tanstack.com/query/latest/docs/framework/react/guides/query-options) (for example `serverInfoQuery` in `src/api/info.ts`). Components call `useQuery(options)` and loaders call `ensureQueryData(options)`, with the same key and the same function. Query keys are arrays that start with the resource name.
- Retries: 4xx responses are never retried. Network and 5xx failures are retried twice. Mutations are not retried automatically, because ledger saves have their own conflict handling (MAZ-87).
- Calculations, conflict merging and shared rules stay in the API or in the shared domain code (MAZ-86). Don't reimplement them in components.

## API models

The API contract is `contracts/openapi.json`. The web app validates it instead of generating code, so a model can narrow what the UI accepts and nothing is generated that nobody reads:

- `src/api/schemas.ts` holds one Zod model per DTO the web app uses (credentials, session, OIDC, entries, shared expenses, search request and response). `apiFetch` parses every response with one, so a server that drifts fails loudly in `ApiError` ("The server sent a response Penny doesn't understand.") instead of corrupting the UI.
- `src/api/schemas.contract.test.ts` converts each model to JSON Schema and compares field names, required sets, enums and numeric/length bounds with the same schema in `contracts/openapi.json`. It also validates the request and response examples in `contracts/fixtures/search-cases.json`. A contract change that isn't mirrored here fails `npm test`; update the model and the test together. When a new endpoint arrives, add its model to `schemas.ts` and to the `models` list in that test.
- The session token that login returns for native clients is part of the model but is dropped immediately in `src/api/auth.ts`. The browser only ever holds the cookie.

Errors: `ApiError.status` is 0 for an unreachable server, otherwise the HTTP status, with the API's `{ error }` text as the message. `401` means the session ended (see below), `409` is a conflict the form must show next to the field that caused it, and `5xx` and network errors are retried twice for reads and shown as a generic "try again" message. Every query function receives a `signal`, and `apiFetch` passes it to `fetch`, so leaving a page or changing a search aborts the request.

## Authentication and sessions

Sign-in is password or optional single sign-on (OIDC), against the API in [authentication](../../docs/migration/authentication.md). The browser never holds a credential in script-readable storage.

- **Cookie session.** `POST /api/auth/login`, `/register` and `/oidc/complete` set `penny_session` (`HttpOnly`, `SameSite=Lax`, `Path=/api`, 30 days, `Secure` in production). Requests use `credentials: "same-origin"`, so the cookie reaches only the page's own origin. `GET /api/auth/me` says who is signed in.
- **Gate.** `AuthGate` (`src/auth/account.tsx`) wraps the app shell. It shows a loading state, a retry screen when the server can't be reached (the user is never signed out by a network or 5xx failure), the sign-in/create-account screen (`src/features/auth/AuthScreen.tsx`) when `/me` answers 401, and the app otherwise. A deep link like `/transactions?q=rent` is kept through sign-in. `/auth/callback` is outside the gate.
- **Forms.** Labelled fields, native autofill hints, client validation that matches the API (valid email, 10 to 256 character password) with focus moved to the first invalid field, and `role="alert"` messages. After a rejected submit the email is kept, a wrong password is cleared and refocused, and a duplicate email (409) focuses the email field.
- **Expiry and sign-out.** A 401 from any private request, or from a refetch of `/me`, ends the session: the app returns to sign-in with a "Your session ended" notice. Sign-out (`src/features/auth/SignOut.tsx`) asks for confirmation, calls `/api/auth/logout` and, only when that succeeds, clears the account's cached data. If the server can't be reached the user stays signed in and is told why. Sessions don't slide: they end 30 days after sign-in.
- **Pending-change protection.** Edits made offline live outside Query in the durable store (`src/offline/`, below). It registers itself with `registerPendingChanges` (`src/auth/pendingChanges.ts`). Sign-out calls `beginSignOut`, which holds the account's saves and counts unsynced edits from IndexedDB (other tabs' included; an unreadable copy or an unreadable legacy copy counts as one): with any pending it refuses, as in the legacy app; otherwise it calls `/api/auth/logout` and then removes the account's browser copies (the record, records and legacy copies set aside, and a legacy copy with nothing unsynced), only if nothing became pending meanwhile. Cancelling restores a retry the hold parked. Expiry never deletes them: they wait in this browser until the same account signs in again.

### Single sign-on

`src/auth/oidc.ts` opens a popup on click (synchronously, so browsers allow it), asks the API to start an attempt, and points the popup at the provider. The provider returns to `/auth/callback` in the popup, which sends its URL to the opener over a same-origin `BroadcastChannel` and closes. The opener posts the URL to `/api/auth/oidc/complete`; the API checks state, nonce and PKCE and sets the cookie. A channel is used because identity providers that send `Cross-Origin-Opener-Policy` cut the `window.opener` link. The browser never sees or stores the authorization code, tokens or client secret.

- **Attempt binding.** The opener only accepts (and acknowledges) a callback whose `state` equals the `state` in its own provider URL, so with several tabs open one can't consume another's callback. The provider address must be `https:` (or `http:` on localhost for a local provider) before the popup navigates to it, and the attempt's `expiresAt` is enforced: an expired attempt ends with "Sign-in took too long".
- **Cancelled.** "Cancel sign-in" ends the attempt with "Sign-in was cancelled. Nothing changed." (also when pressed while the attempt is still starting). Once the callback has arrived, completion is no longer cancellable, so a session the server created is never reported as a failure. A closed popup is only a hint ("The sign-in window looks closed…"), because providers that send `Cross-Origin-Opener-Policy` make `popup.closed` read true while the user is still signing in. A provider-side cancel returns an `error` parameter, which the API rejects like any failed verification.
- **Blocked.** If the browser blocks the popup, the screen says so and offers "Continue in this tab". That flow redirects the tab to the provider, keeps only the attempt's `transaction` id in `sessionStorage` across the round trip, and finishes on `/auth/callback`.
- **Failures.** State mismatches, replays and expired attempts come back as the API's `401` messages and show on the sign-in screen. The attempt is single-use, so the user starts again from the button.
- **Hosting the callback.** `/auth/callback` is a normal SPA route, so the static host must serve `index.html` for it (the nginx image in `deploy/web` does). Register `https://<your-origin>/auth/callback` with the provider and list the same URL in `Oidc__RedirectUris`; the browser sends `<origin>/auth/callback` exactly. Development at `http://localhost:4173` works because the test environment's provider registers it.

### Deployment: cookies and origins

The page and `/api/` must share one origin (the nginx proxy in `deploy/web`, or Vite's proxy in development). Set `PENNY_PUBLIC_ORIGIN` (becomes `Auth__AllowedOrigins`) to the exact browser origin: the API answers any non-GET request whose `Origin` isn't in that list with `403 This origin is not allowed.`, which is the cross-site request protection for the cookie. Keep `PENNY_SECURE_COOKIES=true` behind HTTPS; `false` is for `http://localhost` only, because browsers drop `Secure` cookies on plain HTTP. See [deployment](../../docs/deployment.md#configuration).

### Recovering from auth problems

| Symptom | Cause and fix |
| --- | --- |
| Sign-in succeeds but the next screen asks again | The cookie was not stored. Check `PENNY_SECURE_COOKIES` against http/https, that the page and API share an origin, and that the proxy doesn't strip `Set-Cookie`. |
| `403 This origin is not allowed.` on sign-in | The page's origin isn't in `Auth__AllowedOrigins`. Compare scheme, host and port exactly. |
| `429 Too many attempts` | The 40-requests-per-15-minutes window is shared by sign-in, registration, SSO and reset. Wait for it, or check `PENNY_REAL_IP_FROM` if every user appears to share one address. |
| Password for an imported account is refused | Legacy scrypt hashes don't verify. The operator issues a reset code ([password reset](../../docs/migration/authentication.md#password-reset-maz-123)); a reset screen is not part of MAZ-84. |
| "Sign-in expired" or "could not be verified" after SSO | The attempt is older than 10 minutes, was already used, or the redirect URI differs between the browser, `Oidc__RedirectUris` and the provider. See the [OIDC troubleshooting](../../docs/migration/authentication.md#configuration). |
| "Penny can't reach the server" at start-up | The API or proxy is down. Nothing was cleared; "Try again" re-checks the session. |
| Signed out unexpectedly | The session reached 30 days, was revoked (password reset, sign-out elsewhere) or the cookie was cleared. Sign in again; unsynced offline edits are kept. |

## Cache and session ownership

TanStack Query holds server copies only. It never holds credentials and is not the offline store.

- **Keys.** `src/api/keys.ts`: `["server", …]` is public data (server info, SSO availability); `["session"]` is the signed-in email; `["user", email, …]` is every private query, so two accounts can never share an entry. The server is the page's own origin, so it is implicit. Resource modules build keys with `userKey(email, …)`, taking the email from `useAccountEmail()` (only available below `AuthGate`). Loaders that read private data must use the same keys and run behind the gate.
- **Who clears it.** `src/auth/lifecycle.ts` is the only code that ends or changes a session. `beginSession` (sign-in, registration, SSO) discards anything cached for another account; `endSession` (sign-out) and `expireSession` (401) remove every `["user", …]` query and all mutation state. Removing a query aborts its request.
- **Late responses.** A reply that arrives after sign-out or an account change has no cache entry to land in, and the cancelled `/me` check can't sign the previous user back in. Tests cover both, and also a search whose query changed while its request was in flight.
- **Search.** `src/api/search.ts` implements MAZ-121's `POST /api/v1/search/transactions` as an infinite query keyed by account, normalized filters and query text. The server's cursor is the page parameter, so a cursor can't be reused across queries. A `404` means the server predates search and the UI says so. A failure while loading a later page keeps the loaded results and retries only that page. Personal amounts use the ledger currency from `GET /api/ledger` (shown as a plain number if it can't be read, never under an assumed currency). After ledger, shared expense or household changes call `invalidateSearch(queryClient, email)`; durable offline edits stay out of Query. While edits are pending, offline, or when the server's results predate the latest local change, Activity searches the browser's ledger instead and says "on this device" ([offline search](../../docs/web-offline-sync.md#search)).

## Durable offline ledger

`src/offline/` keeps each signed-in account's personal ledger in IndexedDB (`penny-offline`, one record `{base, local, baseRevision}` per origin and account), acknowledges a save only after it is committed, and syncs with `GET`/`PUT /api/ledger` using the shared merge and recurrence: one sync per account across tabs (Web Locks), 409s re-read and re-merged up to five times, saves allowed during a sync, triggers on sign-in, save, reconnect, tab focus and Retry, backoff otherwise. `OfflineLedgerProvider` (below `AuthGate`, one engine per account, none in the demo) puts each server snapshot it records into Query's ledger entry and invalidates search when the server ledger changed; a 401 calls `expireSession` and keeps the work. Tabs see each other's writes over the `penny-offline-ledger` BroadcastChannel. The legacy Expo web app's `localStorage` copy (`penny:ledger:<email>`) is imported once and removed only after the server has its edits. `SyncStatusBanner` shows "Offline · N changes waiting" with Retry, sync failures and the storage states (blocked, unreadable, newer version); screens read `useLedgerSync()` and save with `useLedgerEngine().save(change)`.

Storage schema, migration and recovery, conflict rules, multi-tab behavior, the origin requirement and limitations: [browser offline ledger and sync](../../docs/web-offline-sync.md).

## Configuration and secrets

The bundle contains no server URL, connection string or credential. In production, nginx (`deploy/web`) serves `dist/` and proxies `/api/` to the API container. Only variables prefixed `PENNY_PUBLIC_` can reach client code, and none exist yet. ESLint rejects `process.env` in `src/`. After each build, `scripts/verify-dist.ts` checks that:

- every asset referenced from `index.html` and the CSS exists and is root-absolute, so deep links like `/transactions` still load;
- the Inter font and both license files are present;
- no third-party script or style is loaded;
- the bundle contains no PostgreSQL URL, connection string, server-side variable name or development address.

## CI

`.github/workflows/web.yml` runs on every pull request and on pushes to `v2`. It runs install, design-token check, lint, typecheck, unit and component tests, the production build with artifact verification, a stale route tree check, and the Playwright smoke. The job has no secrets. Mark **Web lint, types, tests, build and browser smoke** as a required status check in the repository's branch protection.

The Playwright run also has `e2e/auth.spec.ts`: real Chromium journeys for password and SSO sign-in (including a real popup, cancellation, a blocked popup and a failed callback), expiry and sign-out, with `/api` and the provider mocked. `e2e/auth.real.spec.ts` runs the same journeys against the full-stack test environment and is skipped unless `PENNY_REAL_STACK=1` (command in the file). Make it a CI job together with MAZ-95.

`e2e/shell.spec.ts` covers the shell: layouts and overflow at each breakpoint, 200% zoom and doubled text, long names, pinned and system themes, reduced transparency and motion, shortcuts with focus restoration, Back and Forward, the phone drawer, and the demo's isolation.

`e2e/recurring.spec.ts` covers recurring schedules ([above](#recurring-schedules-maz-90)).

`e2e/offline.spec.ts` covers the durable offline store in real Chromium (IndexedDB, BroadcastChannel, Web Locks, the browser's offline switch): a legacy Expo copy imported and kept through a reload and a second tab while the server is down, one PUT on reconnect with both tabs converged, and sign-out refused while a change waits.

Shared households: `tests/households.test.tsx` (component tests against the in-memory household fake in `tests/fakes/householdServer.ts`, which follows the documented server rules and messages) covers create and join, invite expiry, equal/exact/percent splits, the payer-only account, categories and unsynced accounts from the offline ledger, stale edits, offline drafts, recurring rules, share and monthly payments (also a month that can't be re-read after a stale payment), payment-changed states, leave/archive restrictions, read-only archived households and history. `tests/households-model.test.ts` checks the split preview against `contracts/fixtures/shared-splits.json` and amount entry against `money.json`. `e2e/households.spec.ts` runs two people in two browser contexts on desktop and phone (invite expiry, the three split modes, concurrent edits, a stale payment, a repeated monthly payment at month end, hidden payer accounts, archive rules, keyboard entry and 320px). `e2e/households.real.spec.ts` runs the two-person journey against the real .NET API and PostgreSQL with a pinned server clock; it is skipped unless `PENNY_REAL_STACK=1` (command in the file).

Not covered yet: real .NET/PostgreSQL browser journeys on Chromium, Firefox and WebKit in CI (MAZ-95), screenshot baselines (MAZ-96) and the comparison with the cards (MAZ-122). The production image in `deploy/web` still serves the Expo export. It switches to this app at cutover.
