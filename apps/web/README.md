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
| PDF preview | `pdfjs-dist` | 6.4.299 | Receipt PDFs decoded in a same-origin module worker and painted to a canvas, loaded only when a PDF is opened ([receipts](#receipts-maz-94)) |
| Types and lint | TypeScript, typescript-eslint, ESLint | 6.0.3, 8.72.2, 10.14.0 | typescript-eslint supports TypeScript below 6.1, so this app stays on 6.0 until it supports 7. |
| Tests | Vitest, jsdom, Testing Library | 5.1.0, 31.0.0, 16.3.3 | Component tests against the real router and query client |
| Browser tests | Playwright | 1.64.1 | Runs the production build in Chromium, Firefox and WebKit, with `/api` mocked or against the real .NET API ([browser tests](#browser-tests)) |

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
| `npm run test:e2e:real` | The `*.real.spec.ts` journeys against a disposable real stack (needs Docker or Podman and .NET; [browser tests](#browser-tests)) |
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
    features/            screens by feature (auth, search, settings, home, entries, households, trips, organize: accounts and categories, recurring, placeholders), outside src/routes/
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
| Feedback | `Banner`, `OfflineBanner`, `ServerUnreachableBanner`, `SaveErrorBanner`, `useToast()` | Specimens `offline`, `save-error`, `saved-toast`. A save error keeps the draft and names the next step. Toasts are polite live announcements, last 6 seconds and can offer Undo. Keyboard focus pauses them until it leaves; a mouse pointer pauses them for up to 30 seconds, and only where the device hovers with a fine pointer, so on touch screens a tap never keeps one open. On phones the page reserves room for the toast so the last rows scroll clear of it (MAZ-162). |

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

Add entry opens a dialog over the current page (the web card `web-add-entry`); `/entries/new` opens it over Home and returns to `/` when closed. The form is described under [Transactions and Activity](#transactions-and-activity-maz-88).

### Responsive layout

| Width | Layout |
| --- | --- |
| < 768px | Compact top bar (logo, title, round +), bottom glass tab bar with Home, Activity, Shared, Trips and More. More opens the full navigation as a modal drawer. Settings sections are separate pages with an "All settings" link. |
| 768–1099px | Icon rail (labels stay in the accessibility tree), top bar with search and Add entry, two-pane Settings. |
| ≥ 1100px | Full 248px sidebar with section headings and shortcut hints. |

768 and 1100 come from the design proposal. They were checked against real content rather than taken as fixed: the top bar's search and Add entry need about 700px beside a title, and the sidebar's labels and shortcut chips need the full 248px, which leaves under 850px for content below 1100. Playwright (`e2e/shell.spec.ts`) loads every page at 320, 390, 768, 1024, 1100 and 1440px, at 640px (a 1280px window at 200% zoom) and with doubled root text, with a very long account email, and fails on any horizontal scrolling. Move a breakpoint only with those checks.

## Routes and search state

Every legacy URL opens (`tests/shell.test.tsx`): `/`, `/transactions`, `/entries/new`, `/insights`, `/households`, `/households/$id`, `/households/$id/expenses/$expenseId`, `/trips`, `/trips/$id`, `/recurring`, `/accounts`, `/categories`, `/settings` and `/settings/{appearance,currency,server}`. Every screen is now built (trips arrived with MAZ-93, Home and Insights with MAZ-92, the household screens with MAZ-91, accounts and categories with MAZ-89, recurring schedules with MAZ-90 and transactions with MAZ-88, below). Filters live in validated search parameters (`/transactions?q=…&month=…&kind=…`, `/households/$id?month=…&tab=…`, `/categories?kind=income`), so a filtered view can be bookmarked, shared and restored with Back and Forward; dialogs, drawers and toasts are not in the URL.

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
- **Accounts and categories from this browser's ledger.** The form's categories and accounts (and the detail panel's account name) come from the durable offline ledger (`useLedgerChoices`, `src/features/households/choices.ts`), so ones created on this device and not yet synced are included; the server copy in Query is the fallback (the demo, or before the offline ledger loads). Categories are sent by value, so an unsynced one is used at once. An account is sent by id and the server checks it against its copy of the payer's ledger (`400 Payment account not found.`), so an account that copy doesn't have yet is listed as "(waiting to sync)", can't be chosen, and the hint says it can be once it has synced. The form doesn't sync first and submit: shared writes stay online-only and separate from personal offline work. **New category** under Category creates one inline (below) and selects it.
- **Recurring.** Choosing Repeat on a new expense creates a shared rule (weekly, monthly or yearly from the chosen date). Repeating expenses are listed beside the month with Edit, Pause/Resume and Remove; the server records each occurrence on its date with that day's members.

Not in this issue: moving an expense to another household, shared trip editing and the trip screens ([MAZ-93, below](#trips-maz-93); the same tabs serve shared trips under `/trips/$id`), and push. The temporary demo has no households, so `/households` says the server doesn't offer them there.

## Trips (MAZ-93)

Code: `src/features/trips/` (the list, the personal and shared trip pages, the trip form and Share trip, and `model.ts` for phases, ranges, the merged list and totals), `src/features/households/links.tsx` (household tabs linking within `/households/$id` or `/trips/$id`), `src/routes/trips/` and `src/design/trips.css`. Specimens: `trips`, `personal-trip`, `shared-trip`, `trip-form`, `share-personal-trip`, `trip-people`, `trip-balances`; cards `web-trips`, `iphone-trips`, `iphone-trip-detail`, `iphone-trip-form`, `ipad-trip`.

| URL | Screen |
| --- | --- |
| `/trips` | The trip happening now (or the next one) with its numbers, **Trip expense** and **Open trip**, then every trip newest first: personal ones with your spending and expense count, shared ones with their people. **New trip** and **Join a trip**. |
| `/trips/$id` (personal trip id) | Travel dates and phase, your spending, expense count and receipt totals, the trip's expenses (dated before, during or after the trip; each opens the entry's detail) and spending by category. **Trip expense**, **Share trip**, **Edit trip**. |
| `/trips/$id` (shared trip id) | Members, dates, trip total, your spending and your balance for the month; **Expenses** (the whole trip, then **Only you**), **Balances** (`?tab=balances&month=YYYY-MM`), **People** (`?tab=people`) and **History** (`?tab=history`). `?expense=` opens a shared expense in the detail panel; the legacy `?add=1` opens Trip expense once. A household id here opens `/households/$id`. |

Rules:

- **Two kinds of trip.** A personal trip is private ledger data (`{id, name, startDate, endDate, sharedHouseholdId?}`), saved like every personal change: a shared-domain `saveTrip` through the durable offline store, so it works offline and survives a reload. A shared trip is a household with a travel range on the server: online only, like every shared write ([households](#shared-households-maz-91)). `/trips/$id` looks the id up in the personal ledger first, then as a household, as the Expo app did.
- **Names and dates.** 1–80 characters (a personal trip's name is unique ignoring case), real days from 2000 to 2100, the end on or after the start. The form points at the field; the shared rule and the server still decide. Changing dates never moves an expense, a share or a membership.
- **Expenses outside the dates.** A trip is an assignment, not a date filter: an expense belongs to the trip it was assigned to (or added on), whatever its date, so flights booked a month before count. Pages say how many are outside the range.
- **Assignment and deletion.** Only expenses take a trip (the shared `saveEntry` refuses a trip on income or investments, and a trip that was removed). A trip with expenses can't be deleted: the form says how many and to move them first (Edit entry › Trip › No trip). Deleting an empty trip asks first.
- **Sharing a personal trip.** **Share trip** creates a shared trip with the same name and dates (the organizer is you, the currency your ledger's) and then links the personal trip to it with `sharedHouseholdId`. The personal trip's expenses are **never sent**: they stay in your ledger and show only to you under **Only you** on the shared trip, counted in your spending but not in the trip total or anyone's balance. If the link can't be saved in this browser, the new shared trip is archived again, so a failure leaves nothing half done. A personal trip linked to a shared trip you can still see is listed once, as the shared trip; if that trip was archived, the personal trip comes back on its own, marked "was shared". New Trip with **Share with others** creates an empty shared trip directly.
- **Participants.** A shared trip's expense is split among the people on the trip when it is added (every current member, whatever the date: bookings often predate the group). Someone who joins later isn't in earlier expenses ("Not part of your share") and earlier expenses don't change; people who leave keep their past shares. Join a trip uses the same 10-minute codes and currency check as households and opens the trip it joined.
- **Totals, never twice.** Trip total is the shared expenses' full amounts. Your spending is your shares of them plus your private trip expenses (shown when the trip's currency is your ledger's). A personal trip's total is your share of each expense (receipt totals are shown apart when a split differs).
- **Reimbursement.** A shared trip settles like a household, month by month: Balances shows each month's positions, suggested payments and older unpaid months separately, with the household's share and monthly payment flows (Penny records transfers that already happened; it never moves money). A stale payment shows the old and new amounts and only **Review expense**.
- **Organizer controls.** Only the creator invites, removes people, archives and edits the name and dates (**Edit trip**, in the header and People). Leaving, removal and archiving need every month settled.

Tests: `tests/trips-model.test.ts` (phases, ranges, the merged list folding linked trips, the featured trip, totals with private expenses and expenses outside the dates, the form rules, deletion and assignment refusals, a stale link), `tests/trips.test.tsx` (the real app over IndexedDB and the household fake: create with validation and focus, edit, a trip expense, delete refused and confirmed, a duplicate name, an unknown trip, sharing with the expense kept private, a shared New trip, joining after an expense, organizer date edits, monthly balances, `?expense=` and a household id under `/trips`), `e2e/trips.spec.ts` (two browsers on desktop and phone: conversion, joining after existing expenses, refreshes, totals that count nothing twice; keyboard CRUD with the deletion restriction; the demo at 320px) and `e2e/trips.real.spec.ts` (the two-person journey with a repayment against .NET and PostgreSQL). Not covered: screenshot comparison with the cards (MAZ-96/122).

## Transactions and Activity (MAZ-88)

Code: `src/features/entries/` (the form, its draft rules in `model.ts`, pickers, detail and delete, the in-memory draft store, and `useLedgerWriter`), `src/features/activity/` (the page, URL filters in `filters.ts`, rows and totals in `data.ts`, the list), `src/api/projection.ts` and `src/design/activity.css`. Specimens: `activity`, `activity-expenses`, `filters`, `add-expense`, `add-income`, `add-investment`, `entry-extras`, `split`, `entry-detail`, `edit-entry`, `category-picker`, `account-picker`, `date-picker`, `trip-picker`, `repeat-picker`, `search-empty`, `offline`, `save-error`, `delete-entry`, `saved`.

**Writes go through the offline store.** Every personal change (an entry, an edit, a delete, and categories or accounts created inline) is a shared-domain `LedgerChange` (`@domain/commands.ts`: `saveEntry`, `deleteEntry`, `saveCategory`, `saveAccount`) handed to `engine.save` (MAZ-87). It is acknowledged once it is in IndexedDB and syncs with `PUT /api/ledger` from there, so saving works offline and survives a reload; the form never calls the API. "Saved on this device. It syncs when you're back online." says when the save didn't reach the server yet, and the row shows Waiting to sync. The demo has no offline store, so Add entry there says it doesn't save entries.

**The form** (Add entry, or Edit from an entry's detail):

- Type: Expense, Income or Investment. Changing it keeps what was typed and picks a category of the new type. Investments are money set aside: not spending, but they come out of what's left (`net` in `@domain/summary.ts`).
- Amount in the ledger currency (integer cents, up to two decimals, dot or comma), Title, and Category: the five most used categories of the type as chips (a radio group, so arrow keys move the choice), the chosen one always visible, and **All categories** for a filterable list where a new category can be added inline.
- Date and Account are labelled fields; **New account** adds one inline (name and type).
- **More details** holds the rest: Your share for expenses (all mine, split equally between N people, an amount, or a percentage; the legacy `personalShare` rules, previewed as "Your share · counts in your spending"), Repeat for new entries (weekly, monthly or yearly: the entry is the first occurrence of a new rule, and occurrences up to today are recorded by the shared recurrence), Trip for expenses, Note, and Receipt for expenses (attach, upload with progress, preview and download; [browser receipts](../../docs/web-receipts.md), MAZ-94).
- Save is in the dialog footer, which stays in view at the bottom of a long form, and on ⌘↵ or Ctrl+Enter. Validation names the field and moves focus to the first problem.

**Drafts and failures.** A new entry's draft is kept in memory per account while the tab is open: closing Add entry (Esc, the scrim, Keep draft, a page change) keeps it, reopening says "Your unsaved draft is back", Save or **Discard draft** clears it, and signing out clears it. It is never written to storage. Nested pickers and inline creation open over the form, so its draft stays as typed; their own failures (a duplicate name) stay in the picker. A failed save keeps the dialog open with the draft and the reason (storage full or refused, still loading, a rule the shared domain refused) and offers Retry.

**Duplicates and stale versions.** A draft keeps one entry id (and one rule id) for its life, and the busy Save ignores presses, so a repeated submit writes the same entry instead of a second one. An edit and a delete carry the version they started from: if a sync or another tab changed the entry meanwhile, the shared rule refuses it and the form shows their version next to the kept draft with **Keep my changes** (save mine over theirs) or **Use their version**; if it was deleted elsewhere, **Keep as a new entry**. A stale delete shows the latest version and asks again (**Delete anyway**). Delete asks first and offers Undo in its toast.

**Activity** (`/transactions`). Search, the period, totals, quick filters and the list:

| Parameter | Meaning |
| --- | --- |
| `q` | Keyword search. |
| `month=YYYY-MM` or `year=YYYY` | The period, with Previous and Next. Neither is All time. `month` wins over `year`. |
| `day=YYYY-MM-DD` | Only that day (inside the period; on its own it implies its month). |
| `kind` | `expense`, `income` or `investment`. |
| `category` | A personal category id. Shared rows match by its name. |

Each filter is a history entry, so Back and Forward step through them; bad values fall back. Totals (Spent, Earned, Invested, Left) cover the period only, never the search, type, day or category, and Spent includes your share of shared expenses from `GET /api/households/projection` (rows in another currency than the ledger's are left out). Income dated after today (the local date, MAZ-136) is listed and marked **Expected** but left out of Earned and Left until its date, with a note saying how much, so a month's totals match Home's recorded totals (Came in, Spent, Invested, Left to spend); future-dated expenses and investments count. The list is MAZ-121's server search when online and up to date (personal and shared rows, typo and meaning matches, 50-row cursor pages, aborted when the filters change, the server's order), with the category filter applied to the loaded pages. While changes wait to sync, while offline, or when the server's results predate the latest change here, it lists this browser's ledger and the cached shared rows instead ("N matching transactions on this device", the shared substring rule, newest first with a stable tie-break, 50 rows at a time), so unsynced edits show and deleted rows never come back. Personal rows open the entry's detail (Edit, Delete; focus returns to the row, or to the search field when the row is gone); shared rows open the expense in its household. Shared data stays online-only: the projection is read through Query (under the household list key, so every household write refreshes it) and never stored in the offline ledger.

## Accounts and categories (MAZ-89)

Code: `src/features/organize/` (screens, `model.ts` for usage counts, the palette, icons and link moves, `workspace.ts` for reading and saving the ledger), `src/routes/accounts.tsx`, `src/routes/categories.tsx` and `src/design/organize.css`. Cards: `iphone-accounts`, `iphone-account-form` (also the `account-edit` specimen), `iphone-categories`, `iphone-category-form`; the phone's More drawer already lists both (`more`).

| URL | Screen |
| --- | --- |
| `/accounts` | Your payment accounts with their type and usage ("Credit card · 31 entries, 3 schedules", "not used yet"), **Add account**, and a row per account that opens its form. No balances and no bank connection, as the page says. |
| `/categories` | Categories of one kind, chosen with Expense / Income / Investment (`?kind=income`, `?kind=investment`; anything else falls back to expenses), each with its color, icon and usage, and **New category**. |

Rules (the record rules are the shared commands in `src/domain/commands.ts`; the forms check the same ones first so they can point at the field):

- **Accounts:** a name of 1–50 characters, unique ignoring case and surrounding spaces, and a type (Bank account, Credit card, Cash, Other). At most 300.
- **Categories:** a name of 1–50 characters, unique ignoring case within its kind (Expense, Income, Investment), a color from the category palette (`contracts/design-baseline.json` `categoryColors`, which never reuses a meaning color) and an icon from the kit. Icons are stored with the `-outline` suffix the legacy and native apps write; an icon or color saved by an older app is shown (an unknown icon as the price tag) and kept unless changed. At most 300. A category that entries or schedules use keeps its kind, because every entry needs a category of its own kind.
- **Renames keep links.** Entries and schedules point at an account or category by id, so a rename or recolor changes every row that shows it. The shared merge applies field by field, so a rename here and a type change on another device both survive. Server search results refetch after the sync that carried the rename (the offline provider invalidates search whenever the server ledger changed).
- **Protected removal and link reassignment.** An account or category in use can't be removed; the form says how many entries and schedules use it and offers **Move them to** another account (or another category of the same kind) with **Move and remove**, which moves every link and removes the record in one change. An unused one is removed straight away. Both toasts offer **Undo**, which brings the record back and returns exactly the links that moved. The shared command still checks the record wasn't changed elsewhere and the target still exists, so a stale form is refused instead of overwriting.
- **Shared expenses.** Shared expenses carry their category by value, so categories have no server-side links. A payment account you paid a shared expense or shared rule with is checked by the server: removing it fails the sync with `400 Remove household expense links before deleting this payment account.` Only the server knows those links, so the browser finds out at sync. Accounts then shows "*Name* can't be removed yet" with **Put it back**, which restores the account so the rest of the pending work syncs; remove the account from those shared expenses first, then remove it here.

Saving and recovery:

- **Offline first.** Saves go through the durable offline ledger (`useLedgerEngine().save`, `src/offline/`): they are committed in this browser before the form closes, work offline, survive reloads and sync from there. A record not yet on the server is marked "Waiting to sync" (compared with the engine's `base`), and the toast says "Saved on this device" when the network isn't there. In the demo there is no store, so a save writes the in-memory snapshot back with its revision.
- **Failed saves keep the draft.** A rule refusal (duplicate name, a record changed or removed on another device) shows at the field or in the dialog's "Couldn't save" banner with the shared rule's message; a storage failure (full disk, blocked or unreadable storage) says why and offers **Retry**. Nothing is half-saved: a change either is in the store or isn't.
- **Load failures.** Until the first download the page shows a loading state; if that download fails it says why, says nothing was changed and offers Try again. The shell's sync banner covers pending work and sync failures.

**Inline creation.** `AccountFormDialog` and `CategoryFormDialog` take `onSaved(record)` and open over another dialog: Escape and the scrim close only the top one, Tab stays inside it, its submit doesn't reach the form below, and focus returns to the control that opened it. The entry form keeps its own draft and selects the new record. Today the shared expense form uses it (**New category**, with the kind fixed to Expense); the personal entry form (MAZ-88) can use the same components.

Not in this issue: reordering categories (the card's "Drag to reorder" and first-three shortcuts). The personal entry form (MAZ-88) has its own inline category and account pickers. Visual comparison with the cards is MAZ-122.

## Recurring schedules (MAZ-90)

Code: `src/features/recurring/` (the page, the detail and remove dialogs, the form, and `model.ts` for labels, upcoming dates and the draft), `src/design/recurring.css`, and the browser merge (`src/offline/merge.ts`, which re-exports the shared `src/domain/merge.ts`). Cards: `iphone-recurring`, `iphone-schedule-detail`; specimens `recurring`, `recurring-paused`, `schedule`, `edit-schedule`, `remove-schedule`.

| Where | What |
| --- | --- |
| `/recurring` | Schedules grouped as Income, Expenses and Investments: active ones by next date, then paused ones. Each row shows the cadence, next date (or Paused), account, amount, and **Waiting to sync** until the server has the change. **New schedule** opens the form. Empty: "Rent, payday, the usuals." |
| Row › detail dialog | Amount, cadence ("Every month on the 31st (the last day in shorter months)"), Active or Paused, **Edit**, a separate **Pause**/**Resume**, the next three dates, category, account, your share, start date, how many entries it has recorded, the note, and **Remove schedule**. |
| Remove schedule | A separate confirmation: Penny stops recording it, entries it already recorded stay. **Keep schedule** returns to the detail; after removing, focus moves to New schedule (the row is gone). |
| New / Edit schedule | Type (expense, income, investment), amount, name, Repeats (weekly, monthly, yearly), first or next date, category of that type, optional account, your share for expenses (all, split equally, an amount, a percentage) and a note. A live line shows what saving does: the next dates, the last-day fallback for days after the 28th, and the entries a backdated start records at once. Edit and Cancel return to the detail. |

Rules:

- **Personal and offline first.** Schedules are part of the personal ledger, so every change is saved to this browser's durable store (`useLedgerEngine().save`) and syncs from there ([browser offline sync](../../docs/web-offline-sync.md)). A save made offline or with the server down says "Saved on this device. It syncs when you're back online." and the row shows Waiting to sync. A refused save (storage blocked or full, signing out, a rule check such as a removed category or account) keeps the form open with the draft and the reason. The demo stores nothing, so it shows its sample schedules read-only.
- **Occurrences versus the schedule.** A schedule records an entry on each date with the id `{scheduleId}:{date}` (the shared `materialize`), so no device records a date twice. Editing a schedule changes future dates only; entries it already recorded keep their details and are edited as entries (MAZ-88). Removing a schedule keeps its entries. Pausing records nothing; resuming continues on the first date after today, skipping the paused dates (the shared `setScheduleActive`).
- **Anchor day and catch-up.** A new schedule is anchored on its first date's day; moving the next date or changing how often it repeats re-anchors it on the next date (unlike the legacy form, which kept the old anchor when only the frequency changed); otherwise it keeps the anchor (a schedule on the 31st stays on the 31st after a 30-day month or February, leap years included). A first date in the past records every missed date at once when it is saved; an edited next date must be today or later. Due dates are caught up once on load, on save, on tab focus after midnight and after each sync. Unlike the legacy form, creating a schedule doesn't also add a separate entry for the first date (it is the first occurrence, with the occurrence id), and no future-dated entry is created.
- **Time zone.** Dates are calendar days in the browser's local time zone, as in the native and legacy apps (personal recurrence runs on the client; shared household rules run on the server in UTC). A browser in a different time zone may record a date a few hours earlier or later than another device; the occurrence id still prevents a duplicate.
- **Conflicts.** If the schedule changes in another tab or on another device while its form is open, the form says so, keeps the draft and offers **Keep my changes** or **Use the latest**; a stale save is refused by the shared `saveSchedule`. A schedule removed elsewhere shows as removed. A schedule deleted on another device is never brought back by this browser's offline catch-up ([recurrence refinements](../../docs/web-offline-sync.md#conflict-policy)).

Tests: `tests/recurring-model.test.ts` (cadence labels, every frequency through short months and leap years, resume skipping paused dates, catch-up dates, validation, anchoring on edit, removal keeping entries), `tests/recurring.test.tsx` (the real app over fake-indexeddb: grouped list, empty state, a backdated schedule, detail, pause and resume, edit, remove with focus recovery, offline save and one sync, an edit racing another device, blocked storage keeping the draft), `tests/offline/merge.test.ts` and `e2e/recurring.spec.ts` (desktop and phone: all frequencies, the 31st and Feb 29, edit, pause/resume, remove, an offline save through a reload with one PUT and no duplicate entries, and a schedule deleted on another device after an offline catch-up staying deleted). Not covered: the real .NET/PostgreSQL journey (MAZ-95) and screenshot comparison (MAZ-96/122).

## Home and Insights (MAZ-92)

Code: `src/features/home/` (`model.ts` for the ledger view, the month report, grouping, the calendar and URL state; `useMonthReport.ts`; `HomePage.tsx`, `InsightsPage.tsx`, `MoneyFlowChart.tsx`, `MonthCalendar.tsx`, `parts.tsx`), `src/routes/index.tsx`, `src/routes/insights.tsx` and `src/design/home.css`. Specimens: `home`, `home-dark`, `home-amoled`, `home-catppuccin`, `desktop`, `empty-home`, `calendar`, `insights`, `money-flow`; web cards `web-home` and `web-insights`.

| URL | Screen |
| --- | --- |
| `/` | **Left to spend** (the recorded remaining) as the hero, the **projected remaining** under it with the expected income named (scheduled income and income dated after today), Came in / Spent · your share / Invested, **Coming up** (scheduled occurrences not recorded yet and income dated after today), the compact **Follow your money** summary (spent, invested, left) that opens Insights, and **Recent** (the five newest recorded entries, personal and shared, with See all). **Explore your month** below holds the calendar, By category, the full money flow and the month's entries. |
| `/?month=YYYY-MM&day=&q=&kind=&category=` | The month (default this month) and the Explore your month list's filters: a calendar day, a keyword (the shared substring search over title, note, category and account), a type, and a category chosen in By category. Each change is a history entry; bad values fall back. |
| `/insights?month=YYYY-MM` | Came in, Went out, Left over (or Overspent) and the change in spending from last month, the full money flow, and spending by category next to last month's. |

**Reporting formulas.** Nothing is calculated here that the shared domain doesn't already define ([domain rules](../../docs/migration/domain-rules.md)). The page builds a read-only view of the person's ledger with their shared shares joined in (`ledgerWithShared`, as the legacy `ledgerWithHouseholds`; never stored or sent), then reads `selectOverview`/`monthBreakdown` (`@domain/selectors/overview.ts`, `@domain/summary.ts`) and `buildMoneyFlow` (`@domain/selectors/moneyFlow.ts`):

- **Recorded** totals are the month's ledger entries plus the person's recorded shared shares from `GET /api/households/projection?month=` (rows in the ledger currency only, as Activity). **Left to spend** is `net(recorded)` = income − expenses − investment contributions, signed. Below zero the hero says **Overspent** in words and the flow shows **Beyond income**.
- **Projected remaining** adds every occurrence scheduled in the month and not recorded yet: personal rule previews and the projection's shared previews, income, expenses and investments alike (MAZ-139). A recorded occurrence replaces its preview: personal by occurrence id, shared by household, `recurringId` and date. **Expected income** is the income part: scheduled income and income dated after today (below), one-off or recurring. It is named next to the projected amount ("includes $X expected income", or "no income expected"), with what is scheduled to go out.
- **Income dated after today** (the browser's local date from `useToday` in `src/app/useToday.ts`, one value for Home and Activity that re-renders at local midnight and when the tab is shown or focused again; MAZ-136) is expected, not recorded: it counts toward Projected and the expected income, not Left to spend, until its date. Home lists it under Coming up, the calendar rings its day like a scheduled one ("expected or scheduled"), and its row says **Expected** in amber but still opens the entry. Future-dated expenses and investments stay recorded (MAZ-139).
- **Spending is your share**: a split expense counts its `share`, a shared expense your `shareCents`, never the receipt total. Investments are contributions, not spending, and none of these figures is an account balance.
- **The money flow** is recorded-only (a MAZ-136 change): the month's recorded entries, personal and shared at your share, like Left to spend and the native iOS flow, so its Left over (or Beyond income) always matches Left to spend and the compact flow summary. Expected and scheduled income join it once recorded or on their date. It no longer uses the legacy `moneyFlowEntries` (recorded entries plus expected income), which only the legacy Expo Overview keeps. Sources are income categories (and Beyond income in a deficit); destinations are expense categories, Invested and Left over.
- **Totals are filter-independent.** The report is memoized on the ledger, the shared rows, the month and the local date only. The list's day, keyword, type and category filters re-run the list, never the totals; Vitest and Playwright check the hero is unchanged while searching.

**Aggregation rules.** The flow shows at most five categories per side plus "Other … categories" (the domain's rule). By category shows the five largest plus "N more" with the rest summed, so every cent is still shown; with six or fewer nothing is grouped. Insights matches categories with last month by name (shared categories travel by value) and groups beyond eight rows. Shared categories get the id `household-category:<name>:<icon>:<color>` in the view, as in the legacy Overview.

**Chart interactions and accessibility.** The money flow is inline SVG, with no chart library. A container query picks the rendering: a Sankey on cards at least 560px wide, and below that a stacked bar flow with a legend (phones), which fits 320px with no horizontal scrolling. Every node is a button with a full accessible name ("Went out: Home, $1,450.00, 25% of what came in, 70% of what went out"). Click, Enter or Space focuses a node and dims the rest (again clears it), arrow keys and Home/End move between nodes, Escape clears, and a polite focus card announces the selection. Long labels are shortened on the Sankey only (by grapheme), with the full name in the accessible name, a `<title>` and the table. **Show as a table** lists every node with its amount and share of the flow. The calendar is a table of day buttons named with what each day holds ("Friday, November 6: spent $6.20, 1 expected or scheduled"), moved through with arrow keys by day and week; its dots use the meaning colors only, days with a scheduled occurrence or income dated after today get an amber ring, and a text legend explains them ("Expected or scheduled"). By category gives every amount and percent in text; the bars are decoration. Colors come from the tokens (meaning colors for Invested, Left over and Beyond income; categories keep their own color), so light, dark and the pinned appearances apply; a saved legacy AMOLED or Catppuccin theme shows as Dark (see Settings), which is how the `home-amoled` and `home-catppuccin` specimens render on the web. Forced colors draws borders on the swatches.

**Responsive layout.** One column on phones, two from 768px, and from 1100px the 12-column desktop overview: the hero (8 columns) beside Coming up (4), the flow summary (5) beside Recent (7), the calendar (7) beside By category (5), then the full-width flow and list.

**Performance baseline.** One pass over the ledger per month for the report and one per filter change for the list; a calendar built in one pass (no per-day scans); at most 14 flow nodes; 5 recent rows; the list in pages of 50 (Show more). `tests/home-model.test.ts` reports a month of a 20,000-entry ledger with 40 shared rows, its calendar and a keyword search in about 200 ms cold in Vitest/jsdom on a 2026 laptop, and fails above 2 s to catch an accidental quadratic.

**States.** While the ledger loads: "Loading your month…". A ledger with no entries and no schedules shows the first-entry state (`empty-home`: Add your first entry and the currency) instead of zero-value charts; a later empty month shows its zeros and says nothing was recorded. Shared data that can't load says so with Try again, and the totals then cover personal entries; offline, the cached shares are used and labelled.

Tests: `tests/home-model.test.ts` (empty, income-only, expense-only, overspent and break-even months, split shares, expected income, personal and shared preview dedup, currency exclusion, filter independence, small-category grouping, long labels, the calendar, URL fallback, the performance baseline), `tests/home.test.tsx` (the real app: the hero and projected text, overspending, search, type and category filters with stable totals, the calendar by keyboard, flow selection by click and keyboard with the table, the first-entry state, month navigation, Insights' comparison) and `e2e/home.spec.ts` (the demo on desktop and phone with a fixed clock: totals, keyboard selection on the Sankey and the stacked flow, stable totals while searching, a calendar day filter and Back, Insights at 320px, console cleanliness).

Not in this issue: the six-month in/spent chart of `web-insights` (it needs six projection reads; a follow-up) and screenshot baselines (MAZ-96).

## Receipts (MAZ-94)

Code: `src/api/receipts.ts` (the server's type, signature and 10 MiB checks, upload over `XMLHttpRequest` for progress, download), `src/features/receipts/` (`ReceiptField` in the personal and shared expense forms, `ReceiptPreviewDialog`, `ReceiptLink` in the details, `pdf.ts`) and `src/design/receipts.css`. Specimens `entry-extras`, `receipt-upload`, `receipt` and `save-error`. Full behaviour, deployment and troubleshooting: [browser receipts](../../docs/web-receipts.md).

- **Attach:** Photo, File or PDF, or drop a file. Refused files never upload. Progress with Cancel; failures keep the draft with Try again or Dismiss, then focus returns to Photo. Save waits while an upload runs. The receipt link is part of the in-memory draft. Offline, attaching is disabled and the rest of the entry still saves.
- **Preview:** bytes fetched with the session, photos from a `blob:` URL, PDFs painted by pdf.js page by page with Previous/Next, and Download of the original bytes. Damaged PDFs, undecodable photos (HEIC outside Safari), 404 (not yours, or access withdrawn), offline and 401 each have their own state. Closing aborts the request, destroys the pdf.js worker and revokes the URL; focus returns to the opener.
- **Worker and CSP:** the pdf.js worker ships as `/assets/pdf.worker.min-<hash>.js` (`.js` so every server sends a JavaScript type), checked by `scripts/verify-dist.ts`. `scripts/security-headers.ts` is the page Content-Security-Policy (`worker-src 'self'`, `img-src 'self' blob:`, no eval or WebAssembly); `vite preview` sends it, so Playwright runs every spec under it, and the NixOS module's nginx sends the same. `src/app/zodConfig.ts` turns off Zod's eval probe before Zod loads.
- **Tests:** `tests/receipts.test.tsx` (pdf.js replaced), `tests/security-headers.test.ts`, `e2e/receipts.spec.ts` (real pdf.js and image decoding of generated fixtures, SHA-256 download checks) and `e2e/receipts.real.spec.ts`.

## Settings

| Section | What it does |
| --- | --- |
| Account (`/settings`) | Email, and sign-out with its confirmation (moved here from the shell). In the demo: Leave demo. |
| Appearance | Light, Dark or System, and Reduce transparency. Stored per browser in `localStorage["penny.preferences"]` (`src/app/preferences.ts`), applied before first paint, kept after sign-out, synced across tabs. A saved legacy `amoled` or `catppuccin` theme becomes Dark. |
| Currency | The ledger currency. It can change only while the ledger has no entries or recurring rules, as in the legacy app, and the reason is shown; if the server doesn't send those lists it stays fixed rather than guessing. Saving writes the snapshot back with its `revision`: a 409 reloads and asks again, other failures keep the choice and offer Retry, success shows a toast with Undo. Shared households keep their own currency. |
| Server | The page's own origin and the server version, read-only: the web always uses the server it was opened from. |

The native-only settings (app lock, server picker, notifications) are omitted; the web card's "Show cents", "Week starts on" and "Export data" wait for the screens that use them.

## Temporary demo

"Explore a demo" on the sign-in screen runs Penny on sample data without an account (`src/demo/`). It replaces `apiFetch`'s transport with an in-memory stand-in for the endpoints the web uses (session, ledger read and revision-checked write, search with cursor paging); other endpoints answer 404, so a screen that needs a real server says so. It is isolated and temporary: no request reaches the API (Playwright checks this), it runs as `demo@penny.invalid` so its cache keys can't match a real account, nothing is stored, and Leave demo or a reload ends it and drops its cache. It can't be started while signed in. Limitations: it only covers search, Activity, Home, Insights, currency and personal trips (one sample trip; not shared households or shared trips), and Add entry says the demo doesn't save entries (it has no offline store to save them to); the sample data is made up and fixed to the current month, with the default categories and two schedules on the month's last day (MAZ-92), which it previews and never records.

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

`.github/workflows/web.yml` runs on every pull request, on pushes to `v2`, nightly and on demand. **Web lint, types, tests, build and browser smoke** runs install, design-token check, lint, typecheck, unit and component tests, the production build with artifact verification, a stale route tree check, and the mocked Playwright smoke in Chromium. **Browser smoke (mocked API, firefox/webkit)** runs the same smoke on the other engines, and **Real-stack browser journeys (chromium/firefox/webkit)** runs the real-server specs ([browser tests](#browser-tests)). No job has secrets. Mark all of them as required status checks in the repository's branch protection. GitHub runs scheduled workflows from the default branch only, so the nightly run starts once this workflow is on it.

### Browser tests

Every Playwright run serves the production build (`npm run build` first) with `vite preview`. `PENNY_REAL_STACK` chooses the suite:

| Suite | Specs | Server | Command |
| --- | --- | --- | --- |
| Mocked smoke | `e2e/*.spec.ts` except `*.real.spec.ts` | `/api` and the OIDC provider mocked per test with `page.route`; port 4175 | `npm run test:e2e` |
| Real stack | `e2e/*.real.spec.ts` | The [full-stack test environment](../../docs/migration/test-environment.md): PostgreSQL 18 with pg_trgm and pgvector in a container, a migrated `penny_test_<run id>` database on tmpfs, the .NET API built from this checkout with test controls, and the local OIDC provider; port 4173, a redirect URI the provider registers | `npm run test:e2e:real` |

`npm run test:e2e:real` (`scripts/e2e-real.ts`) runs `scripts/test-env/penny-env.mjs run --oidc -- npx playwright test` with `PENNY_REAL_STACK=1`: the environment is created, used and always torn down in one command, and Playwright gets `PENNY_API_URL` (where `vite preview` forwards `/api`) and `PENNY_TEST_TOKEN`. Arguments go to Playwright: `npm run test:e2e:real -- households.real --project=webkit-phone`. It needs what the test environment needs: Docker or Podman, the pinned .NET SDK, the search model and restored packages ([prerequisites](../../docs/migration/test-environment.md#prerequisites)). It seeds nothing and leaves the server clock unpinned, because OIDC sign-in attempts expire by real time (the `empty` seed pins the clock to 2026-10-15); specs that need a date pin it through `/api/test/clock` and unpin it afterwards.

**Browser matrix.** `PENNY_E2E_BROWSERS` (`chromium`, `firefox`, `webkit`; default `chromium`) and `PENNY_E2E_DEVICES` (`desktop`, `phone`, `tablet`; default `desktop,phone`) choose the projects, named `<browser>-<device>`:

| | desktop | phone | tablet |
| --- | --- | --- | --- |
| chromium | Desktop Chrome | Pixel 7 | Galaxy Tab S9 |
| firefox | Desktop Firefox | none | none |
| webkit | Desktop Safari | iPhone 15 | iPad (gen 11) |

Firefox has no mobile emulation (Playwright refuses `isMobile` there) and the specs use `isMobile` to choose phone journeys, so Firefox runs desktop only and asking for its phone or tablet adds no project. This is browser emulation; native simulators and devices are MAZ-81.

| CI job | Engines | Devices |
| --- | --- | --- |
| Web lint, types, tests, build and browser smoke | chromium | desktop, phone |
| Browser smoke (mocked API) | firefox, webkit (one job each) | desktop, phone (Firefox: desktop) |
| Real-stack browser journeys | chromium, firefox, webkit (one job and one environment each) | desktop, phone (Firefox: desktop); nightly and manual runs add tablet |

**Isolation.** Each real-stack job has its own environment (random run id, container, database, ports, control token and receipt directory), and every spec registers new random `.test` accounts, so tests never depend on each other's data. Specs in one environment run one at a time (`workers: 1`) because they share the server clock. Amounts and names are made up; no secret or real financial data is used. The only test doubles are the local OIDC provider (`scripts/test-env/oidc-provider.mjs`: auto-approving, throwaway certificate) and Playwright's browser clock where a spec fixes it; the real-stack specs never mock a business API call. No live check against a real identity provider runs in CI.

**Artifacts.** Traces, screenshots and (real stack) videos are kept for failed attempts in `test-results/e2e/`, the HTML report and `results.json` in `test-results/e2e-report/`. The real-stack run also copies the API log, PostgreSQL log and `environment.json` (no token or passwords) to `../../test-results/fullstack/<run id>/`. In GitHub Actions they are uploaded as `web-playwright-report`, `web-playwright-report-<browser>` and `web-real-stack-<browser>` on the run's summary page. Open a trace with `npx playwright show-trace <trace.zip>` (or at trace.playwright.dev) and a report with `npx playwright show-report <dir>`.

**Retries and flaky tests.** CI retries a failed test once. WebKit projects get a 60s test timeout instead of 30s, because the two-person household journeys run 3-4 times slower there. A test that passes on retry is reported as flaky in the list output, the job's annotations and the HTML report, and its failed attempt keeps its trace, screenshot and video. Triage: open the failed attempt's trace (network, console and DOM at each step) next to `api.log` from the same run, decide whether the app, the test or the environment is at fault, and fix it or file an issue with the trace. Don't raise timeouts or retries to hide it. Reproduce with the same project, for example `npm run test:e2e:real -- --project=webkit-phone --repeat-each=5`. Example: on `webkit-phone` (iPhone 15), `households.real` first waited out its 3-minute timeout because the "Share marked as paid" toast covered the next expense row, and Playwright's pointer resting on the toast paused it (the toast pauses on hover), so it never left; the spec now moves the pointer away and waits for the toast to close.

On NixOS, where Playwright's downloaded browsers can't run, give `test-env run` a command that runs Playwright in the official image on the host network, with the repository at the same path. From the repository root: `npm run test-env -- run --oidc -- podman run --rm --network host --userns=keep-id -e HOME=/tmp -e PENNY_REAL_STACK=1 -e PENNY_API_URL -e PENNY_TEST_TOKEN -e PENNY_E2E_BROWSERS -v "$PWD:$PWD" -w "$PWD/apps/web" mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test`. Without `PENNY_REAL_STACK=1` and the `test-env` wrapper, the same `podman run` runs the mocked smoke.

`e2e/auth.spec.ts` has the password and SSO sign-in journeys (including a real popup, cancellation, a blocked popup and a failed callback), expiry and sign-out, with `/api` and the provider mocked. `e2e/auth.real.spec.ts` runs the same journeys against the real stack.

`e2e/shell.spec.ts` covers the shell: layouts and overflow at each breakpoint, 200% zoom and doubled text, long names, pinned and system themes, reduced transparency and motion, shortcuts with focus restoration, Back and Forward, the phone drawer, and the demo's isolation.

`e2e/recurring.spec.ts` covers recurring schedules ([above](#recurring-schedules-maz-90)).

`e2e/offline.spec.ts` covers the durable offline store in real Chromium (IndexedDB, BroadcastChannel, Web Locks, the browser's offline switch): a legacy Expo copy imported and kept through a reload and a second tab while the server is down, one PUT on reconnect with both tabs converged, and sign-out refused while a change waits.

Transactions and Activity: `tests/entries.test.tsx` (the form in the real app over fake IndexedDB and a revision-checked fake ledger in `tests/fakes/ledgerServer.ts`) covers expense, income and repeating investment entries, the four share modes, field validation and focus, ⌘↵ with a repeated press, draft retention and discard, inline category (also a duplicate name) and account creation, offline saving, edit with focus return, a stale edit (keep mine), delete with Undo, and the demo. `tests/entries-model.test.ts` checks the draft rules, idempotent saves, stale-version refusal, frequent categories, the URL filters, local rows and period totals (income dated after today left out, matching Home on `redesign-states.json` `dana-2026-10`, and the today/tomorrow boundary). `tests/today.test.tsx` checks `useToday` (`src/app/useToday.ts`, the shared local date that re-renders at midnight and on return to the tab) with fake timers. `tests/activity.test.tsx` covers totals with shared shares independent of filters, shared rows online and from cache offline, URL filters through Back, category filtering of shared rows by name and the empty search. `e2e/transactions.spec.ts` runs on desktop and phone: a keyboard-only add found in Activity, validation and draft retention through a closed dialog and inline category creation, an offline save kept through a reload and synced on Retry, filters through Back, Forward and reload, a stale edit resolved with their version, a confirmed delete, and 320px with Save in view.

Shared households: `tests/households.test.tsx` (component tests against the in-memory household fake in `tests/fakes/householdServer.ts`, which follows the documented server rules and messages) covers create and join, invite expiry, equal/exact/percent splits, the payer-only account, categories and unsynced accounts from the offline ledger, stale edits, offline drafts, recurring rules, share and monthly payments (also a month that can't be re-read after a stale payment), payment-changed states, leave/archive restrictions, read-only archived households and history. `tests/households-model.test.ts` checks the split preview against `contracts/fixtures/shared-splits.json` and amount entry against `money.json`. `e2e/households.spec.ts` runs two people in two browser contexts on desktop and phone (invite expiry, the three split modes, concurrent edits, a stale payment, a repeated monthly payment at month end, hidden payer accounts, archive rules, keyboard entry and 320px). `e2e/households.real.spec.ts` runs the two-person journey against the real .NET API and PostgreSQL with a pinned server clock, in the real-stack suite.

Accounts and categories: `tests/organize.test.tsx` (the real app over IndexedDB and a revision-checked ledger that applies the household-link rule) covers every account type and category kind, usage counts, renames that keep links, duplicate and empty names, in-use protection, Move and remove with Undo, unused removal, offline saves marked "Waiting to sync" and synced on reconnect, a full-storage failure with Retry, the refused removal of an account a shared expense links (Put it back), the kind in the URL, legacy colors, keyboard inline creation from the shared expense form (Escape, Tab and focus return) and the demo. `tests/organize-model.test.ts` covers usage text, names against the shared commands, icons, the palette against the tokens, link moves and Undo, the field-level merge of a rename and refused removals. `e2e/organize.spec.ts` runs the CRUD journeys by keyboard on desktop and phone, an offline save through a reload, the refused removal, 320px with long names and doubled text, and the form in light, dark, forced colors and reduced transparency.

Not covered yet: screenshot baselines (MAZ-96) and the comparison with the cards (MAZ-122). The production image in `deploy/web` still serves the Expo export. It switches to this app at cutover.
