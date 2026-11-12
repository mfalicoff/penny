# Native personal and shared trips (MAZ-76)

[Native app](../apps/ios/README.md) · [Native households](ios-households.md) · [Households on the server](migration/households.md) · [Shared expenses](migration/shared-expenses.md) · [Settlement](migration/settlement.md) · [Browser trips](../apps/web/README.md#trips-maz-93)

This page describes the Trips tab of the SwiftUI app: personal trips, shared trips, sharing a personal trip, joining a trip, what each total counts, how travel dates behave and how a shared trip settles. It covers the code, the accessibility identifiers and the acceptance scenarios.

## Where the code is

| Piece | File | Tests |
| --- | --- | --- |
| Phases, travel dates, the form's field rules, private expenses from before sharing, the expense count Delete is refused for | `PennyDomain/Trips/TripRules.swift` | `TripRulesTests` |
| Trip expense opening Add entry on a trip | `PennyDomain/Ledger/EntryEditor.swift` (`start(onTrip:ledger:)`), `PennyUI/Shell/ShellModel.swift` (`openTripExpense`, `addEntryTripId`), `PennyUI/Entries/EntryFormSheet.swift` | `TripRulesTests.tripExpense`, `TripViewTests.tripExpense` |
| Shared trip routes (`POST /api/households/trips`, `PATCH /api/households/{id}/trip`) | `PennyData/API/APIClient+Trips.swift`, `HouseholdService.createTrip`/`updateTrip` | `TripClientTests` |
| The merged list, the featured trip, shared trip totals | `PennyData/Trips/TripList.swift` (`TripList`, `TripCard`, `SharedTripTotals`) | `TripListTests` |
| Create and edit shared trips, Share trip with its undo, a trip's whole expense list, the trip form | `PennyData/Trips/TripModels.swift` (`TripDirectory`, `SharedTripExpenses`, `TripFormModel`) | `TripModelTests` |
| Screens | `PennyUI/Trips/` (the tab, the personal trip, the trip form, Share trip, the shared trip's sections); the shared trip page is `HouseholdPage` in `PennyUI/Households/HouseholdView.swift` | `TripViewTests`, `PennyUITests/Trips/TripJourneyTests` |
| Previews of every specimen | `PennyUI/Trips/TripSpecimens.swift` | |

No endpoint was added: the app uses the routes MAZ-56–59 already serve (`contracts/openapi.json`, `postApiHouseholdsTrips`, `patchApiHouseholdsIdTrip` and the household routes).

## Personal and shared trips

| | Personal trip | Shared trip |
| --- | --- | --- |
| What it is | Private ledger data: `{id, name, startDate, endDate, sharedHouseholdId?}` | A household with a travel range on the server |
| Who sees it | Only you | Everyone on the trip sees its shared expenses and their own share |
| Saved | Through the durable offline ledger (MAZ-71): works offline, Undo in the toast | Online only, like every shared write; a failure keeps the form as typed |
| Expenses | Your personal expenses assigned to it (Trip expense, or More details › Trip) | Shared expenses, split among the people on the trip |
| Settles | Nothing to settle | Month by month, like a household |

- **Trips tab** (`trips`, card `iphone-trips`): the trip happening now (or the next one) with when it is, your spending or its people, and **Trip expense**; then Now, Upcoming and Past. Personal rows show "Personal", the expense count and your spending; shared rows show "Shared" and the number of people. **New trip** and **Join a trip** are at the bottom. Pull to refresh syncs the ledger and reads the shared trips again; when they can't be read, the last list stays with "Shared trips may be out of date".
- **Personal trip** (`personal-trip`, card `iphone-trip-detail`): the phase ("In 3 days", "Now", "Past"; always words), "Personal", the dates, **Your spending**, the expense count and how many are outside the dates, the receipt total when a split makes it differ, every assigned expense (each opens the entry), and spending by category. **Trip expense** opens Add entry on the trip; **Share trip** and **Edit trip** (toolbar).
- **Shared trip** (`shared-trip`, `trip-people`, `trip-balances`; cards `iphone-trip-detail`, `ipad-trip`): the household page in trip words. Above the month balance: the phase, "Shared", the dates, people and currency, **Trip total** and **Your spending**. **Expenses** is the whole trip whatever the month ("Shared with everyone", each opening its detail), then **Only you**; **Balances** is the month's (previous and next month); **People** has Invite, **Edit trip** (the organizer), Leave trip and Archive trip. History is in the toolbar. **Trip expense** opens the shared expense form, as **Expense** does on a household (the context-specific add action).
- **Where shared trips are listed.** In the Trips tab and in the Shared tab's Trips section; both open the trip page (`penny://trips/<household id>`). `penny://households/<id>` of a shared trip opens the same page under Shared. A personal trip id is looked up first, then a household id, as in the Expo app and the browser.

## Names, dates and travel-date behavior

- **Names** are 1–80 characters after trimming; a personal trip's name is unique ignoring case ("You already have a trip with this name.", shown on the field). **Dates** are real days from 2000 to 2100, the end on or after the start. The form points at the field; `saveTrip` and the server still decide.
- **A trip is an assignment, not a date filter.** An expense belongs to the trip it was assigned to (or added on), whatever its date, so flights booked a month before count. Pages say how many are outside the range ("1 outside the trip dates"; on a shared trip, "2 expenses are dated outside the trip and still belong to it"), and each such row says "outside the trip dates".
- **Changing dates never moves anything.** Editing a trip's name or dates (personal, or the organizer's Edit trip on a shared trip) never moves an expense, a share or a membership.
- **Assignment and deletion.** Only expenses take a trip (`saveEntry` refuses a trip on income or investments, and a trip that was removed). Reassigning an entry moves it between trips. A trip with entries can't be deleted: Delete trip is disabled and says how many and to move them first (Edit entry › Trip › No trip). Deleting an empty trip asks first.

## Sharing a personal trip (conversion privacy)

**Share trip** (`share-personal-trip`) creates a shared trip with the same name and dates (you're the organizer; the currency is your ledger's), then saves the private link `sharedHouseholdId` on the personal trip through the offline ledger. It explains first: "Your N expenses stay private", "Balances settle by month".

- **Earlier private expenses are kept and never sent.** They stay in your ledger on the personal trip and show only to you under **Only you** on the shared trip ("from before sharing"). They count in your spending, never in the trip total or anyone's balance. The server never receives them (the journey test checks the shared trip has no expenses after sharing and that the other person never sees one).
- **Nothing half done.** If the link can't be saved on this device, the new (empty) shared trip is archived again and the sheet says nothing changed. If archiving also fails, it says the shared trip exists unlinked and to archive it from People before sharing again.
- **One trip in the list.** A personal trip linked to a shared trip you can still see is listed once, as the shared trip; opening the personal trip directly says "Shared as …" with **Open shared trip**. If that shared trip is archived or you left it, the personal trip comes back on its own, marked "Personal · was shared". The link is private ledger data: joining, leaving, removal and archiving never add, change or clear it.
- **New trip with Share with others** creates an empty shared trip directly (online only; the demo can't share).

## People and historical splits

- A shared trip's expense is split among the people on the trip when it is added: every current member, whatever the date (bookings often predate the group). Someone who joins later isn't in earlier expenses ("no share") and earlier expenses don't change; people who leave keep their past shares. The server computes and stores the shares; the form previews them with the server's rounding.
- **Join a trip** uses the same 10-minute codes, QR scanner, `penny://join` links and currency check as households (`HouseholdStartSheet` in trip words) and opens the trip it joined.
- **Organizer controls.** Only the organizer (the creator) invites, removes people, archives and edits the name and dates. Leaving, removal and archiving need every month settled.

## Totals, never twice

- **Trip total**: the shared expenses' full amounts, every month.
- **Your spending** on a shared trip: your shares of its shared expenses plus your private expenses from before sharing (only when the trip's currency is your ledger's: two currencies can't be added up). Each expense counts once: private entries are personal ledger rows, shared ones live on the server, and none is both (`SharedTripTotals`).
- **Personal trip**: your share of each assigned expense; the receipt total is shown apart when a split makes it differ.
- **Home and Insights** already count a shared expense once, at your share, through the household projection, and private trip expenses once, as personal entries ([native overview](ios-overview.md#shared-and-private-money)).

## Monthly settlement

A shared trip settles like a household, month by month: Balances shows the month's positions, suggested payments and older unpaid months separately, with Record paid for full suggested transfers and Mark as paid on a single share. Months never offset each other, so October bookings and November meals are reimbursed separately. Penny records transfers that already happened; it never moves money. A stale payment shows the old and new amounts and only Review expense ([native households](ios-households.md#recording-payments-reimbursements)).

## Accessibility

- Phases, "Personal"/"Shared", "outside the trip dates" and balances are words, never color alone. Rows combine into one VoiceOver element; text wraps at large sizes; touch targets are at least 44 points.
- Identifiers (`AccessibilityID.Trips`): screens `screen.trips`, `screen.trip` (personal), `screen.sharedTrip`, `screen.tripForm`, `screen.shareTrip`; rows `trip.<trip id or household id>`; `trips.{new,join,featured,featuredAdd,notice}`; `tripPage.{phase,dates,yourSpending,total,outside,addExpense,share,edit,sharedAs,openShared,privateNote,onlyYou,sharedExpenses,category.<id>}`; `tripForm.{name,start,end,share,save,close,delete,deleteNote,error,nameProblem,dateProblem}`; `shareTrip.{confirm,close,error,private}`. Private expenses are `entry.<id>`; a shared trip's expenses, balances and people use the household identifiers (`household.expense.<id>`, `household.balanceRow.<id>`, `household.member.<id>`, `household.section`, `household.addExpense`).

## Specimens

| MAZ-76 specimen | Card | Native |
| --- | --- | --- |
| trips | `iphone-trips` | `TripsView` |
| personal-trip | `iphone-trip-detail` | `PersonalTripPage` |
| shared-trip | `iphone-trip-detail`, `ipad-trip` | `HouseholdPage` for a shared trip (Expenses with Only you) |
| trip-form | `iphone-trip-form` | `TripFormSheet` |
| share-personal-trip | none | `ShareTripSheet` |
| trip-people | `ipad-trip` (people column) | People section |
| trip-balances | `ipad-trip` (balances) | Balances section |

As for households, `docs/design/penny-redesign/screen-inventory.json` and the Penpot proposal were replaced by `docs/design/penny-ios` (MAZ-132) and MAZ-122's finalized handoff isn't in the repository, so these screens follow the cards and the domain rules; MAZ-122 owns the visual comparison. Adaptations: names are emails; shared rows in the list show the number of people rather than your share (that needs every trip's expenses); Expenses, Balances and People are one segmented page, with Edit trip in People; on iPad the trip page is the detail column (no separate people column).

## Acceptance scenarios

Run on clean iPhone and iPad simulators against the [full-stack environment](migration/test-environment.md); the automated ones are `TripJourneyTests` in the Full plan (`PENNY_UI_ONLY=PennyUITests/TripJourneyTests apps/ios/scripts/ios.sh ui-test full`).

1. **Conversion and two users (automated):** a personal trip with an expense dated before it; Share trip; the server's shared trip has no expenses and the ledger links the trip; the expense shows under Only you; a shared expense before anyone joins (only you in it); the second person joins through the API; a second shared expense splits between both while the first keeps its participants; Trip total $170.00 and Your spending $134.00 count each expense once; Balances shows the other person.
2. **CRUD and deletion (automated):** New trip; Trip expense opens Add entry on the trip and the entry is assigned on the server; Delete trip is disabled with the reason while it has the entry; once the entry is moved to No trip from another device, the trip is deleted.
3. **Organizer date edit:** change a shared trip's dates; every expense stays, and the outside-the-dates count changes.
4. **Monthly payment recovery:** on the last day of a month (pin the server clock), record a suggested payment on the trip; record it from the other device first to see the stale state with the current suggestions.
5. **Archived link:** archive a shared trip that a personal trip links to; the personal trip comes back as "Personal · was shared" with its private expenses.
6. **Offline:** with the connection dropped, New trip saves a personal trip (Waiting to sync); Share with others, Share trip and Join say nothing was sent and keep what was typed.
7. **Contextual navigation:** from the Trips list, Trip expense on a shared featured trip opens its page with the expense form; Back returns to Trips. On iPad, the same in the detail column, then rotate.

## Limitations

- Not verified on a physical device or across every appearance: the private-to-shared conversion, monthly payment recovery and contextual navigation/back on iPhone and iPad in light and dark, Dynamic Type at the largest sizes, and VoiceOver. The journey tests capture light-mode screenshots on simulators only.
- The list doesn't show your share of each shared trip (it would read every trip's expenses); the trip page does.
- Private expenses from before sharing are listed and counted only when the trip's currency is your ledger's.
- The demo has no shared trips; Share trip and Join a trip are hidden there.
