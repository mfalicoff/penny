# Native entries, Activity and search (MAZ-73)

How the iPhone and iPad app adds, edits, deletes, finds and filters personal entries. The ledger rules themselves (amounts, splits, recurrence, stale checks) are in [native ledger rules](ios-ledger-domain.md); the offline engine behind every save is in [native offline sync](ios-offline-sync.md).

## Where the code is

| Piece | File | Tests |
| --- | --- | --- |
| Form rules: draft, kind switching, duplicate-submit guard, conflicts, drafts kept for later, keypad, most-used categories | `PennyDomain/Ledger/EntryEditor.swift` | `EntryEditorTests` |
| Activity filters, period totals, day groups, the shared search normalization and the local index | `PennyDomain/Ledger/ActivityFilters.swift`, `SearchText.swift` | `ActivityFiltersTests` (`foldCases` and `pendingCases` from `search-cases.json`) |
| Save flow over any workspace | `PennyData/Entries/EntryFormModel.swift` | `EntryFormModelTests` (including an offline save through `AccountWorkspace` and the fake server) |
| Server search state (MAZ-121), paging, reconciliation | `PennyData/Search/ActivitySearch.swift` | `ActivitySearchModelTests` |
| Entry sheet, keypad, pickers, split, More details | `PennyUI/Entries/` | `EntryFlowTests` |
| Inline account and category creation | The pickers present MAZ-74's `AccountFormSheet` and `CategoryFormSheet` (`PennyUI/Organize/`, the category form prefilled with the search text) and select the saved record; see [organize](ios-organize.md) | `OrganizeFormTests`, `EntryFormModelTests` |
| Activity list, chips, search scope, filters sheet | `PennyUI/Activity/` | `EntryFlowTests` |

Previews of every card this issue owns are in `PennyUI/Entries/EntrySpecimens.swift`, named after their cards.

## Adding and editing an entry

- **Open:** the tab bar +, the iPad sidebar's Add entry, `penny://entries/new`, or the empty Activity's Add entry. Edit opens the same sheet from Activity (swipe or context menu) or from the entry detail.
- **Type:** Expense, Income or Invest. Switching type keeps the amount, name, date, account and note; the category becomes the one last chosen for that type, or its most used one. Split, trip and receipt stay in the draft but only expenses save them.
- **Amount:** on iPhone a keypad under the form (the system keyboard appears only for the name); on iPad the decimal keyboard. Up to nine whole digits and two decimals, as `Money.cents` accepts.
- **Category:** the three most used categories of the type (by their use in the latest 500 entries and the schedules) as chips, the selected one always visible, and a More chip for every category with search, New (inline) and Edit categories (opens Settings › Categories; the draft is kept).
- **Date, Account, Split:** labeled rows. Accounts are labels, never balances; None is allowed. New account creates one inline and selects it.
- **More details:** receipt (expenses only: photo or file picker, upload with progress, preview; see [native receipts](ios-receipts.md)), repeat (new entries only), trip (expenses only) and note. Repeating creates a schedule whose first occurrence is this entry.
- **Save:** the toolbar check, so the keyboard never covers it. It shows a spinner and can't be tapped twice; a save that succeeded never runs again. The sheet closes on success and the shell shows the toast with Undo and a success haptic.

### Splits and investments

- A personal split stores only two numbers: the receipt `total` and your `share`. Every report, total and Activity row uses your share; the total is shown beside it ("−$6.40 of $12.80").
- **Equally** is a head count including you (2–100), rounded half up to the cent. **Amount** is your share as money; **Percent** is 0–100 with two decimals. A share above the total is refused.
- Editing a split entry opens it as **Amount** with your share: the ledger does not keep how the share was computed.
- Income and investments are always the full amount. An investment is a contribution (money put in), not a portfolio value; it counts against Left to spend like spending and shows in indigo, unsigned.
- A date after today is recorded now; the form says so. Income dated after today is expected (MAZ-136): it counts toward Projected, not Left to spend or Activity's Came in, until its date. Expenses and contributions dated after today count at once.

### Failures and drafts

- A refused draft (no name, zero amount, invalid split…) stays as typed and the banner says why, with an error haptic.
- A failed save (storage full, ledger still loading) keeps the draft and offers Try again.
- **Stale edit:** if the entry changed on another device after the form opened, the save is refused (`entryChangedOnAnotherDevice`); the banner offers **Review latest**, which reopens the form on the current version. If it was deleted elsewhere, the form says so and closes. A stale delete is refused the same way (`entryChangedBeforeDelete`). Nothing is overwritten.
- Removed account, category or trip: refused with the shared message naming the field to choose again.
- **Closing with changes** asks: Discard changes, Keep as draft, or Keep editing. Swipe-to-dismiss is disabled while there are changes. If something else replaces the sheet (a deep link, Settings, Edit categories), the draft is kept on the shell's shelf (`EntryDraftShelf`, one for a new entry and one per edited entry) and comes back with "Your unsaved entry is back" and Discard. Drafts are stored on this device per account (`<ledger file>.drafts`, written durably beside the ledger), so they survive quitting the app; they are removed with the account at sign-out and move with it on an email change. A draft whose save is still running stays on the shelf until that save succeeds, so if a deep link replaced the sheet and the save then fails, the draft comes back.
- **Offline:** saving works the same; the entry is on this device and the row says "Waiting to sync" until the server has it.

## Activity

- Recorded entries (never scheduled previews) grouped by day, newest first, each day with its net (income minus spending and contributions, your shares). The period's Spent / Came in / Invested totals sit above the list; filters and search never change them. They are recorded totals, the same as Home's for a month: income dated after today is listed (marked "Expected") but not in Came in, and the line names it apart ("$600.00 expected"; VoiceOver: "… expected income dated after today, not counted yet").
- **Filters:** kind chips (All, Expenses, Income, Investments), the period chip and the Filters sheet (month, year or all time; one day; type; category). With a type chosen, its four most used categories appear as chips with All categories. The month follows Home's month picker.
- **Rows:** tap for the detail (a shared expense opens its household); swipe for Edit and Delete. Delete always asks first and offers Undo in the toast. On iPad (regular width) the list is a 400 pt column and a personal entry opens beside it, highlighted, as on the `ipad/activity` card; deleting it clears the detail. In a narrow width the detail is pushed.
- **Long ledgers:** local results render 200 rows at a time and add more as the list nears the end; the search index normalizes each row once per ledger change, and only when there is a query.

### Search

| Situation | Where results come from | Shown as |
| --- | --- | --- |
| No query | This device's ledger | The list |
| Query, online, nothing pending, server has search v1 | `POST /api/v1/search/transactions` with the filters, `sort: date-desc`, 50 per page | "N results from your server, including similar words and meanings"; more pages load at the end of the list |
| Query with pending changes, offline, or the demo | This device: the shared normalization (accents, case, width, whitespace) and literal title/document matches only | "On this device", with the reason and what it leaves out (typo and meaning matches, shared expenses) |
| Server search failed | This device | The error with Retry, above this device's results |

- Server search is debounced (300 ms), cancels the previous request, and drops any answer for older filters, another account, or a ledger that changed since it started (a save or sync): it searches again instead (`LedgerSyncModel.reconcile`). Local rows are never mixed into server pages, and a result key appears once across pages.
- The category filter is applied to server rows on the device (search v1 has no category field), so a page can hold fewer rows than its size.
- A server 404 is an ordinary search failure: the screen shows this device's results with the error, and the next query asks the server again.

## Accessibility identifiers

Screens: `screen.addEntry`, `screen.editEntry`, `screen.categoryPicker`, `screen.accountPicker`, `screen.datePicker`, `screen.split`, `screen.entryExtras`, `screen.accountForm` and `screen.categoryForm` (inline creation, see [organize](ios-organize.md)), `screen.entryDetail`, `screen.activity`, `screen.activityFilters`.

Controls: `entryForm.{kind,amount,title,category.<id>,moreCategories,date,account,split,details,save,close,discard,keepDraft,discardDraft,restoredDraft,reviewLatest,conflict,deleted,retry,futureDate}`, `banner.saveError`, `keypad.{0-9,separator,delete}`, `categoryPicker.{<id>,new,edit,close}`, `accountPicker.{none,<id>,new}`, `datePicker.{calendar,today,yesterday,done}`, `split.{mode,people,input,share,error,done,cancel}`, `entryExtras.{repeat,note,trip.none,trip.<id>}`, `entryDetail.{edit,delete}`, the receipt identifiers in [native receipts](ios-receipts.md#accessibility), `deleteEntry.{confirm,cancel}`, `activity.{filters,period,filter.<all|expense|income|investment>,category.<all|id>,totals,edit,delete,loadMore,showMore,searching,searchEmpty,searchAllMonths,clearFilters,searchError,searchRetry,scope.server,scope.device}`, `filters.{period,month.previous,month.next,year.previous,year.next,oneDay,day,kind,category,clear,done}`, and the existing `entry.<id>` rows.

## Simulator scenarios (for MAZ-81/82)

Each runs on a clean iPhone and iPad simulator against the [full-stack test environment](reference/test-environment.md) (real .NET and PostgreSQL), or in the demo (`PENNY_TEST_DEMO=1`) where noted.

1. **All kinds and splits:** add an expense split equally three ways, by amount and by percent; an income repeating monthly; an investment. Check the rows, the day nets and the period totals (your shares).
2. **Inline creation:** from the account picker add an account; from the category picker add a category; the draft's amount, name and note survive and the entry saves with both.
3. **Keyboard and Save:** type a long name with the keyboard up and save from the toolbar; with VoiceOver, type the amount with the keypad.
4. **Validation and retry:** save with no name, with "12.345", with a 1-person split; each banner names the field and the draft stays. Fill the disk or stop the server mid-save (fault controls), then Try again.
5. **Draft recovery:** type an entry, open Edit categories (or a `penny://` link); reopen Add entry and see "Your unsaved entry is back".
6. **Offline save:** go offline, add and edit entries ("Waiting to sync"), search finds them "On this device"; reconnect and see them on the server.
7. **Conflicts:** open an entry for editing, change it from the web, save on iOS: "Changed on another device" → Review latest. Delete it from the web, then delete on iOS: refused.
8. **Search:** online typo and meaning queries; filters by kind, month, year and day; paging past 50 results; rename and delete an entry, then search again; reconnect after offline; switch account and server (no results from the previous one); a signed-out (401) search asks to sign in.

## Not done yet

- Category chips order by count of use; ordering by recent use is MAZ-134.
- Offline search does not include shared expenses (they are not cached on the device yet).
