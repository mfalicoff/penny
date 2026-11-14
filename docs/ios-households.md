# Native households and shared expenses (MAZ-75)

[Native app](../apps/ios/README.md) · [Households on the server](reference/households.md) · [Shared expenses](reference/shared-expenses.md) · [Settlement](reference/settlement.md) · [Shared recurrence](reference/shared-recurrence.md) · [Native overview](ios-overview.md)

This page describes the Shared tab of the SwiftUI app: households, invitations, shared expenses and their splits, recording payments, monthly balances, history, repeating shared expenses, and leaving, removing and archiving. It covers what people see, how shared money differs from personal money, what recording a payment means, the code, the accessibility identifiers and the acceptance scenarios.

## Where the code is

| Piece | File | Tests |
| --- | --- | --- |
| Invite codes and `penny://join` links: typing rules, the HTTPS rule, another-server detection | `PennyDomain/Households/InviteLink.swift` | `HouseholdDomainTests` (`InviteLinkTests`) |
| Split preview (the server's `HouseholdSplits` rounding), percentage parsing, the monthly cutoff, the time zone offset | `PennyDomain/Households/HouseholdSplit.swift` | `HouseholdSplitTests` (golden `contracts/fixtures/shared-splits.json`) |
| The `penny://join` route and the join sheet route | `PennyDomain/DeepLink.swift`, `PennyDomain/Navigation/ShellRoute.swift` (`HouseholdStart`, `DetailRoute.householdHistory`) | `InviteLinkTests.shellRoute` |
| Wire models and API routes (MAZ-56–59) | `PennyData/API/HouseholdWireModels.swift`, `PennyData/API/APIClient+Households.swift` | `HouseholdClientTests` |
| What failures mean (stale, membership, restriction…) | `PennyData/Households/HouseholdFailure.swift` | `HouseholdClientTests.failures` |
| Display rules: who is who, members on a date, share status, Mark as paid, history sentences | `PennyData/Households/HouseholdRules.swift` | `HouseholdRulesTests` |
| The list, one household's page model, payments and stale handling | `PennyData/Households/HouseholdModels.swift` (`HouseholdDirectory`, `HouseholdModel`) | `HouseholdModelTests` |
| The expense and repeating-expense form: draft, validation, payer privacy, kept drafts, Review latest | `PennyData/Households/SharedExpenseForm.swift` | `SharedExpenseFormTests` |
| The invite QR code (Core Image) and decoding (Vision) | `PennyData/Households/InviteQRCode.swift` | `InviteQRCodeTests` (round trip) |
| An invite waiting for the right account | `PennyData/Households/InviteHandoff.swift`, `PennyUI/RootView.swift`, `PennyUI/Auth/AuthGate.swift` (`ShellHost`), `PennyUI/Auth/InviteSignInCard.swift` | `HouseholdViewTests.handoff` |
| Screens | `PennyUI/Households/` | `HouseholdViewTests`, `PennyUITests/Households/HouseholdJourneyTests` |
| Previews of every specimen | `PennyUI/Households/HouseholdSpecimens.swift` | |

The app talks to the endpoints MAZ-56–59 already serve (`contracts/openapi.json`); no endpoint was added. The client sends the documented bodies (`timezoneOffsetMinutes` on create, join and expenses, `{revision}` on deletes, `{fromUserId, revision}` on share payments) and encodes every id as a single path segment.

## Shared versus personal

- **Personal entries** live in the offline ledger on the device and sync (MAZ-71). **Shared expenses** live only on the server: the app reads and writes them online and never copies them into the personal ledger. A shared expense counts in your spending at **your share**, through the household projection Home already reads ([native overview](ios-overview.md#shared-and-private-money)); the rest belongs to the others.
- Each shared write goes to the server at once and then the page reads again, because balances, suggestions, eligibility and restrictions are the server's. Nothing shared is stored on disk; the Shared tab keeps the last answer in memory and says when it couldn't refresh.
- **Online requirement.** Offline, the Shared tab and household pages keep what they last showed and name the problem ("You're offline. Shared households need a connection, so nothing was sent."). Forms keep everything typed; Try again is offered when it can help.

## Households and members

- **Shared tab** (`iphone-shared-list`): households and shared trips, each with your balance this month ("you're owed $142.50", "you owe $38.20", "Settled") and gray monograms, the overall line, then Join with a code and New household.
- **Create** (`household-create`): a name and your ledger currency (everyone who joins must use it). You become the creator and the first member.
- **Household page** (`iphone-shared`, `ipad-shared`): the members, the month with your balance as the hero ("November · you're owed"), previous and next month, **Record payment** (opens Balances) and **Expense**, then **Expenses**, **Balances** and **People**. History is in the toolbar. On iPad the page is the detail column. Months answer in any order, so only the answer for the month still on screen is kept (a quick ‹ ‹ never shows October under September, and Record paid uses that month's suggestion). A read asked for while one runs (a save landing during a pull to refresh) runs again after it. A household opened again after the month rolled over shows the new month, unless you chose a month yourself since. A 401 on any shared request ends the session and asks you to sign in again, as the ledger and receipts do.
- **People** (`iphone-shared-people`): current members (Creator or Member, the day they joined) and former members (the day they left). The creator can invite, rename, remove a member (swipe or context menu) and archive; anyone can leave.
- **Restrictions** (the server's, shown in its words when it refuses): leaving and removal need a zero balance in every month; the creator can't leave while others remain; archiving needs everyone settled in every month and is final. Each confirmation explains the rule before anything is sent.
- **Read only.** An archived household (it no longer appears in the list) and a household you left show their history with a banner that says why, and offer no writes. A refusal because membership changed elsewhere ("You're no longer a member of this household, or it was archived") is followed by a fresh read.

## Invitations

- **Invite** (`invite`): the creator gets a 10-character code shown as text (two groups of five, read character by character to VoiceOver) **and** as a QR code, with a live countdown ("Expires in 9:42") and **New code**. One code works for everyone it's shared with until it expires (10 minutes) or is replaced; a new code replaces the old one. The countdown starts when the request is sent (on this device's clock), so it never runs past the server's expiry.
- **The QR code** encodes `penny://join?code=<CODE>&server=<server URL>` (percent-encoded), generated with Core Image's built-in generator. Scanning it with the iOS Camera app opens Penny on the join screen.
- **Share** sends the code as text, the link, or the QR image through the standard share sheet; **Copy** copies the code.
- **Join** (`join-group`): type the code (spaces, dashes and dots are ignored, any case), or **Scan a QR code**. Errors are the server's: "Invite code is invalid or expired." for an expired or replaced code, the currency rule, "You are already a member.", and the rate limit.
- **Camera.** Penny asks for the camera only when the scanner opens (`NSCameraUsageDescription`, set in `Configuration/Penny.xcconfig`: "Penny uses the camera only to scan a household invite QR code. Nothing is recorded or saved."). Denied, or no camera, the scanner says so and offers **Type the code instead** and, when denied, Open Settings. The scanner reads only QR codes; anything that isn't a Penny invite is rejected with the reason and scanning continues.

### Invite links and servers

| Link | What happens |
| --- | --- |
| `penny://join?code=…&server=<the server you use>` or no `server` | The join sheet opens with the code filled in. Join sends it to your server. |
| A different HTTPS server, while signed in | The join sheet names both servers and says your sign-in stays here. **Sign out to join on …** keeps the invite and opens Settings; after signing out, the sign-in screen offers **Connect to …**, then you sign in there and the join sheet opens with the code. Close drops it. |
| A different server, while signed out | The sign-in screen asks **Connect to …?** first. Connecting runs only the usual server check (`/api/info`, no credentials). |
| Plain HTTP (except `localhost`, an IPv4 literal in 127.0.0.0/8 such as `127.0.0.1`, and `::1`, in development builds only; a name like `127.evil.example` is not loopback), a server with credentials, a query or a fragment, no code or a bad one, a repeated query key | Refused: "This invite link can't be used", with the reason. Nothing is sent. |

A link that arrives over something else (Settings, on iPad its detail column; a sheet; another tab) first closes it and switches to Shared; the join sheet is presented in a later update, once the Shared tab is on screen and no sheet is still closing (`ShellRoute.pendingHouseholdStart`). Presenting it in the same update dropped it on iPhone and, while the iPad detail column swapped stacks, crashed SwiftUI. The invite stays in `InviteHandoff` until its sheet is actually on screen, so a sheet that never appeared doesn't lose it. **Sign out to join on …** likewise opens Settings only after the join sheet has closed. A session token is only ever sent to the server that issued it (`APIClient` refuses another server, MAZ-67), so following an invite can never send the current sign-in elsewhere. An invite that arrives while the app is locked waits until it's unlocked; the demo never takes one.

## Shared expenses

- **Form** (`shared-expense`, `shared-split`, `shared-payer`): amount, name, category (your expense categories; shared categories travel by value), **Paid by** (the members on the date), the split, the date, **Paid with** (your own accounts, only when you paid), Repeat (new expenses) and note. Save is the toolbar check.
- **Splits.** Equally (members sorted by id, the leftover cents one each to the first), **Amounts** (must add up to the total; zero shares are allowed) and **Percent** (two decimals, must add up to 100%; leftover cents to the largest remainders). The preview uses the server's own rounding, so "Your share · in your spending" is exactly what the server stores. While the amounts or percentages don't add up, the footer says how much is left or too much and Save refuses with the same words. Switching to Amounts or Percent starts from an even split.
- **Who's included.** Members active on the expense date (from their local join day, until the day they left); for shared trips, every current member. Joining never changes earlier expenses.
- **Payer privacy.** The account row appears only when you are the payer and lists only your accounts. The account is dropped when you choose someone else as payer (and comes back if you choose yourself again, so saving doesn't clear the link), and is never sent for an expense someone else paid (the server keeps theirs). Other members never receive it, and history never contains it.
- **Detail** (`shared-expense-detail`): the original total, who paid, the split, your share, category, note, your account (only when you paid), each member's share with its status (Paid the expense, Not repaid yet, Repaid, Settles with the month, Nothing to repay) and the expense's change history.
- **Edit and delete.** Delete is "for everyone" and asks first. Once any share is repaid, the total, payer, month and shares can't change and it can't be deleted; the form and detail say so and keep the name, category, note and day editable.

### Drafts and stale edits

- A refused or failed save keeps the form exactly as typed, with the reason; Try again when it can help.
- **Saving** sends once: the sheet closes as soon as the server has the expense (the page reads again in the background), Close is disabled while it saves, and a saved expense is never kept as a draft or sent again.
- **Closing with changes** asks: Discard changes, Keep as draft, Keep editing. Swipe-down is disabled while there are changes. A sheet replaced by a link keeps its draft too. A kept draft comes back the next time you add (or edit) that expense, with "Your unsaved expense is back", Discard, and the cursor in the field you were editing. Kept drafts last until Penny quits (shared data isn't stored on the device).
- **Stale edit.** If someone changed the expense or rule after you opened it, the save is refused ("Changed by someone else", nothing saved) and **Review latest** reopens the form on the current version. If it was deleted, the form says so.

## Recording payments (reimbursements)

Penny **records** payments that already happened outside Penny; it never moves money, and recording never changes anyone's spending or the expense's shares. Every payment screen says so.

- **One share** (`record-share`): **Mark as paid** on a member's share, offered to that member or the payer, while both are members, the share is positive and unpaid, the month has no monthly payment yet and the household isn't archived. It settles that whole share early.
- **Monthly** (`record-monthly`): Balances shows each member's balance (paid and share this month), the suggested full transfers, and **Record paid** for the people involved. Monthly payments open on the month's last day (UTC); before that the sheet says when, and points to Mark as paid. Once a month has a monthly payment, its expenses settle with the month. Overdue months (earlier months still owing) are listed and open their own balances; months never offset each other.
- **Stale payment** (`payment-stale`): if the expense changed after you opened the sheet, nothing is recorded and the sheet shows the old and new total and your share, who edited it and when, and only **Review expense**. If the monthly suggestion changed (someone else recorded it, or an expense changed), it shows what's suggested now and **Review balances**. Already-paid shares and closed months are refused with the server's message.

## Repeating shared expenses

Choosing Repeat (weekly, monthly, yearly) on a new expense creates a shared rule whose first date is the expense date, split the same way; the server records each occurrence with the members active that day (equal when the members changed). Repeating expenses are listed under Expenses ("Monthly · you pay · next Dec 1"); a row opens the form (with Active), and its context menu pauses, resumes or deletes it. Deleting a rule keeps the expenses it recorded. Their previews count in Home's Projected through the projection (MAZ-139).

## History

`iphone-history`: every change by everyone, newest first, grouped by day, with All, Expenses, Payments and Members. Each row is a sentence ("bea@example.test edited Costco run") with what changed ("Category: Shopping → Groceries"), recurring additions ("Rent was added automatically") and payments ("You recorded Jo's $61.40 share payment to …"). Former members see the history they took part in.

## Accessibility

- People are gray monograms; balances and statuses are always words ("you're owed", "Repaid", "owes"), never color alone. Money uses tabular digits and spoken labels.
- The invite code is spelled out for VoiceOver; the QR code has a label that says what scanning does; the countdown is spoken in minutes.
- Text wraps rather than truncates; touch targets are at least 44 points; banners put their action under the text at accessibility sizes.

Identifiers (`AccessibilityID.Households`): screens `screen.shared`, `screen.householdStart`, `screen.household`, `screen.householdExpense`, `screen.sharedExpenseForm`, `screen.invite`, `screen.inviteScanner`, `screen.recordShare`, `screen.recordMonthly`, `screen.paymentStale`, `screen.householdHistory`; controls `shared.{create,join,overall,notice,household.<id>}`, `householdStart.{mode,name,currency,create,code,joinButton,scan,error,otherServer,useOtherServer,close}`, `household.{balance,recordPayment,addExpense,section,history,month,previousMonth,nextMonth,readOnly,notice,invite,leave,archive,rename,monthlyNote}` and the rows `household.{expense,member,balanceRow,rule,removeMember}.<id>`, `household.suggestion.<from>-<to>`, `household.overdue.<YYYY-MM>`; `invite.{code,qr,expires,share,copy,new}`; `scanner.{preview,denied,typeCode,close}`; `sharedExpense.{total,yourShare,edit,delete,history,share.<id>,markPaid.<id>}`; `sharedForm.{amount,title,category,date,mode,yourShare,account,note,repeat,active,save,close,problem,error,reviewLatest,restoredDraft,keepDraft,discard,payer.<id>,split.<id>}`; `recordShare.{confirm,explanation}`, `recordMonthly.{confirm,explanation}`, `payment.error`, `paymentStale.{old,new,review}`; `history.{empty,filter.<filter>,event.<id>}`.

## Specimens

| MAZ-75 specimen | Card | Native |
| --- | --- | --- |
| shared | `iphone-shared-list` | `SharedView` |
| household | `iphone-shared`, `ipad-shared` | `HouseholdDetailView` (Expenses) |
| balances | `iphone-shared-balances` | Balances section |
| people | `iphone-shared-people` | People section |
| household-create, join-group | `iphone-household-create` | `HouseholdStartSheet` |
| invite | `iphone-shared-people` (invite card) | `InviteSheet` |
| shared-expense, shared-split, shared-payer | `iphone-shared-expense-add`, `iphone-split` | `SharedExpenseFormSheet` |
| shared-expense-detail | none (from `ipad-shared`'s detail) | `HouseholdExpenseView` |
| record-share, record-monthly | `iphone-record-payment` | `PaymentSheet` |
| payment-stale | `iphone-payment-stale` | `PaymentSheet` stale state |
| history | `iphone-history` | `HouseholdHistoryView` |
| archive | none | The archive confirmation (People) and the archived read-only page |

`docs/design/penny-redesign/screen-inventory.json` and the Penpot proposal were replaced by `docs/design/penny-ios` (MAZ-132); MAZ-122's finalized handoff isn't in the repository, so these screens follow the cards and the domain rules; MAZ-122 owns the visual comparison. Adaptations: names are emails (members carry only an email), Record payment opens Balances (a payment is recorded from a suggestion or a share), and Expenses, Balances and People are a segmented picker in one page.

## Acceptance scenarios

Run on clean iPhone and iPad simulators against the [full-stack environment](reference/test-environment.md); the automated ones are `HouseholdJourneyTests` in the Full plan (`PENNY_UI_ONLY=PennyUITests/HouseholdJourneyTests apps/ios/scripts/ios.sh ui-test full`).

1. **Create, invite, join (automated):** create a household; the invite shows the code, the QR code and the countdown; the second person joins with the code through the API; they appear under People.
2. **Equal split and share payment (automated):** add an expense of $90 split equally; the server stores $45/$45 and never sends the other member your account; the other person records their share; the share shows Repaid and offers no payment.
3. **Concurrent edit (automated):** open the edit form, the other person renames the expense, save: "Changed by someone else", Review latest shows their title, nothing overwritten.
4. **Membership restriction (automated):** the creator tries to leave while another member remains: refused with the server's reason; still a member.
5. **Join by link (automated):** a `penny://join` link for this server fills in the code and joins; one for another server shows the confirmation and joins nothing; a malformed one is refused.
6. **Camera denied or absent (automated):** the scanner says so and Type the code instead keeps working; an expired code says "Invite code is invalid or expired."
7. **Exact and percent splits:** $100 by amounts with a remainder (the footer names what's left), then by percent 50/25/25; your share matches the server's row.
8. **Monthly settlement:** on the month's last day (pin the server clock), Record paid for a suggestion; Balances settles; recording the same suggestion from the other device first shows the stale state with the current suggestions.
9. **Stale share payment:** open Mark as paid, change the expense's total from the other device, confirm: old and new amounts, nothing recorded, Review expense.
10. **Leave, remove, archive:** settle every month, remove the other member, archive; the household leaves the list and its page is read-only from a link.
11. **Repeating:** add a monthly repeating expense; it's listed with its next date; pause and resume it; Home's Projected includes its preview.
12. **Offline:** drop the connection (fault controls), add an expense: the form keeps it and says nothing was sent; Keep as draft, reconnect, reopen: the draft and its focus come back.
13. **Camera app:** on a device, scan the invite QR code with the Camera app: Penny opens on the join sheet.

## Limitations

- Shared trips open their trip page (MAZ-76, [native trips](ios-trips.md)): the household page with the trip's dates and totals, Expenses for the whole trip and Only you.
- Receipts on shared expenses: an existing receipt stays linked and shows on the detail; picking one is MAZ-78.
- Kept shared drafts last for the session only (shared data is online-only and isn't stored on the device).
- The iPad sidebar doesn't list households directly yet (Shared opens the list); the `ipad-shared` card's balances column is the Balances section.
- Activity still lists personal entries only; shared expenses show in Home (projection) and on the household pages.
- Not verified on a physical device: scanning with the real camera and with the iOS Camera app, and the share sheet's targets; the simulator has no camera, so the scanner tests cover the denied and no-camera paths and the decoder is tested on the generated image.
