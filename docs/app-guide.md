# App behavior and limits

[App showcase](../README.md) · [Documentation](README.md)

Detailed behavior behind the features shown in the [showcase](../README.md). Setup and operating instructions live in [Development](development.md) and [Self-hosting](deployment.md).

## Entries, reports, and accounts

- Add, edit, delete, search, and filter income, expenses, and investment contributions.
- Amounts and split percentages accept either a dot or a comma as the decimal separator (for example, `12.34` or `12,34`), with up to two decimal places. Thousands separators and mixed decimal separators are not accepted.
- Investment contributions appear in a separate Invested total and are excluded from spending. Cash remaining is the month's income minus expenses and contributions; it is not an account balance. Contributions track money invested, not portfolio value or returns.
- Monthly overview, calendar, category breakdown, and personal-share totals. The overview's summary cards show recorded entries only, and the last card is always **Cash remaining**. Upcoming recurring occurrences (personal and shared) appear in the calendar and entry list but are not added to the cards. The money-flow chart includes upcoming recurring income with recorded expenses and investments, and "Where it went" counts recorded spending only. Transactions reports stay recorded-only.
- In the overview's **Your entries** list, tap the **All categories** pill below search to filter by one category. Choose **All categories** again to clear it. The selection combines with search, the selected calendar day, and the All/Expenses/Income/Investments tabs; choosing an incompatible entry type clears the category. Navigation preserves the selection. Monthly totals, calendar, and charts remain unfiltered.
- Interactive monthly Sankey diagram: income categories → monthly flow → expense categories, invested, and left over. Personal shares determine band widths. Outflows beyond the income shown (including expected recurring income) are labeled explicitly; smaller expense categories are grouped without dropping their amounts. The chart scrolls horizontally on phones.
- Attach a photo from your library or an image/PDF from files (up to 10 MB).
- Split by equal shares, a personal amount, or a percentage. The original total and your share are both retained; reports count your share only.
- Create permanent households with other Penny accounts. Record an expense once, split it equally or by exact amounts or percentages, and see only your share in personal transactions and reports. Each household has a monthly recap, reimbursements, recurring expenses, receipts, and change history.
- Create a shared trip, invite other Penny accounts with a short-lived code, and add expenses together. Each person's share appears in their reports; the trip shows all its shared expenses and uses monthly balances for reimbursements. Existing personal trips can be shared while their earlier private expenses stay private.
- Weekly, monthly, and yearly income, expenses, and investments; pause, resume, or remove a schedule.
- Custom category names, colors, and icons. A category used by entries or schedules can be renamed and restyled but not deleted, and its type cannot change.
- Payment accounts: add bank accounts, credit cards, cash wallets, or other accounts in **Accounts** or directly from an entry. Assign or change the optional payment account on expenses, income, investments, and recurring schedules. Account names appear on entries and can be searched. Rename accounts freely; accounts linked to entries or schedules cannot be deleted until those links are reassigned. These are manually tracked accounts, with no bank connection or balance reconciliation.
- Sign-in accounts and cross-device sync. Personal ledger changes are saved on the device while offline and sync when the server is reachable again. Revision checks retry server races and merge independent device edits.
- Photos render in-app; web PDFs render in the browser; native PDFs open through the system share/open sheet.
- A clearly labeled, temporary demo without an account.
- Mobile-only biometric app lock, configured in **Account settings → Biometric app lock**.

## Mobile app protection

Turn on **Biometric app lock** in account settings on iOS or Android. Enabling requires an enrolled Face ID, Touch ID, or Android Class 3 biometric and a successful biometric check. The preference is saved securely on that device, survives app restarts, and is not synced to other devices or reset by signing out. Web has no app-lock toggle.

When enabled, Penny requires authentication at launch and after returning from the background. Your device passcode/PIN is allowed as a recovery method when unlocking or disabling protection. Cancellation or failed authentication leaves the app locked; use **Unlock Penny** to retry. Open dialogs and unfinished drafts are hidden while locked and restored after unlocking.

This protects access to the app UI, not the server account or cached ledger with an additional encryption layer. Existing home-screen widgets and notification previews are outside the app lock; remove widgets or adjust system notification previews if they expose information you want hidden.

Native builds must include `expo-local-authentication`. The app config plugin adds the iOS `NSFaceIDUsageDescription`; Android biometric permissions come from the library. No additional iOS entitlement, Apple Developer capability, or provisioning-profile update is needed for biometrics. Rebuild the native app after installing the module; an OTA update cannot add it, and Face ID cannot be tested in Expo Go. See [Expo's SDK 57 LocalAuthentication documentation](https://docs.expo.dev/versions/v57.0.0/sdk/local-authentication/).

## Shared households

Sign in, open **Households**, and create a household. Its currency is your personal ledger currency. The creator can tap **Invite member** to generate a code that expires after 10 minutes; another signed-in person joins with that code. People can belong to more than one household. Everyone in a household must use the same currency. A personal ledger's currency cannot change while its owner is an active household member.

Every active member is included in a new expense's equal split by default. You can enter exact amounts or percentages instead, including zero shares. Any active member can add or edit an expense, but only its payer can attach one of their private payment accounts. Household receipts are visible to members; payment account details remain private to the payer. Changes are recorded in the household audit history. Recurring household expenses are generated by the server, with each occurrence split among members active on its date. If membership changes, a recurring exact or percentage template falls back to an equal split for the new group.

Active household recurring expenses also appear in the overview calendar and entry list as **Scheduled** previews showing your share. Tap a preview to edit its household schedule. Browsing months does not record expenses or advance the schedule; previews stay out of spending totals and Transactions reports until the server records them. Paused or removed schedules have no previews, and recorded or deleted occurrences are not previewed again.

The day someone joins is eligible for household expenses, using the calendar date on their device when they joined. Expenses from earlier dates keep the membership that applied then.

To reimburse an individual expense before month-end, open its **More actions** menu on a phone (or its member shares on a wider screen), then tap **Mark as paid** beside the share. Either the member repaying their share or the expense's original payer can record it; both must still be active members. Confirm the sender, recipient, and full share amount after transferring the money outside Penny. This records an existing payment, not a money transfer. Each share has its own paid status, so a three-person expense can be partially reimbursed. Payments appear in change history and reduce only the expense month's outstanding balance, without changing personal spending totals.

Once an expense has a recorded share payment, its payer, total, member allocations, month, and household cannot change, and it cannot be deleted. Its title, notes, category, receipt, and date within the same month remain editable.

The household's **Monthly recap** shows its recorded expenses, each member's remaining balance, and suggested reimbursements for that month. On the last calendar day of the month or later, tap **Record paid** to record a full remaining suggested transfer; the server uses UTC dates for this cutoff. Once any monthly reimbursement is recorded, individual payment recording closes for that month to prevent double payments; use the remaining monthly suggestions instead. Reimbursements have no payment-account choice and do not add a transaction or reduce anyone's reported spending. An unpaid month remains overdue independently of later months. A member can leave or be removed only after all of their monthly balances are settled; their previous expenses and audit history remain. The creator cannot leave while other active members remain. Archiving requires every monthly balance to be settled.

### Shared households in the v2 web app

The new browser app (`apps/web`, MAZ-91) has the same rules under **Shared** in the sidebar (Together › Shared) or the phone tab bar. A household opens with its members and your balance for the month, then three sections: **Expenses** (the month's expenses with their full totals and your share, and repeating expenses), **Balances** (each member's position, suggested payments and older unpaid months) and **People** (members, invite codes and the creator's controls). **History** lists every change by everyone. Open an expense for its shares, repayments and change history.

- **Online only.** Shared households need a connection. While offline you can read what is already on screen, but nothing shared can be saved; the form you were filling in stays open with your entries, and **Retry** sends it once you are back.
- **Who sees what.** Everyone in the household sees each expense's full total, who paid and every share. Your personal reports count only your share. When you are the payer you can pick one of your own accounts; nobody else ever sees which one.
- **Conflicts.** If someone else changes an expense while you edit it, Penny keeps your edits and shows their version: keep your changes on top of theirs, or take theirs. If an expense changes while you are recording a payment for it, nothing is recorded; Penny shows the old and new amounts and asks you to review the expense first.
- **Recording payments.** Mark as paid and Record paid note money that already changed hands outside Penny. Penny never moves money, and payments never count as spending.

**Monthly settlement example** (made-up amounts). Alex, Bea and Cam share a household in October. Alex pays Hydro, $90.00, split equally ($30.00 each). Bea pays Internet, $60.00, split by amount: Alex $30.00, Bea $15.00, Cam $15.00.

| Member | Paid | Shares | October balance |
| --- | --- | --- | --- |
| Alex | $90.00 | $60.00 | gets back $30.00 |
| Bea | $60.00 | $45.00 | gets back $15.00 |
| Cam | $0.00 | $45.00 | owes $45.00 |

Suggested payments: Cam → Alex $30.00 and Cam → Bea $15.00. If Cam repays his Hydro share early with **Mark as paid** ($30.00 to Alex), October's suggestions shrink to Cam → Bea $15.00. From October 31 (UTC; still the evening of October 30 in the Americas) Cam or Bea can **Record paid** for that full $15.00, which settles October; after that, individual share payments for October are closed. If Cam doesn't pay, October shows as **Overdue** in November and stays separate: November's balances start from zero. Cam can't leave, and Alex can't archive the household, until every month is settled.

## Shared trips

Sign in and open **Trips** to create a shared trip or join one with its invitation code. The creator opens the trip's **People** controls to generate a code and invite others. Any participant can add an expense, choose who paid, and split it equally, by amount, or by percentage. Trip expenses can be dated before or after the travel dates, including bookings made before the group was created. New expenses include the people currently in the trip; earlier expense splits do not change when someone joins later.

To invite people to a personal trip, open it and tap **Invite people**. Expenses already assigned to that personal trip remain private and appear in a separate section for you. Add new shared expenses in the shared trip for everyone to see. Trip expenses are shown together across dates, while reimbursements stay in separate monthly balances.

See [Phone notifications](deployment.md#phone-notifications) for device registration and push prerequisites. The [household implementation plan](households-implementation-plan.md) records the original design tasks and acceptance examples; this guide describes current behavior.

## Recurring schedules in the browser app

In the new browser app (`apps/web`, MAZ-90), **Recurring** (Manage › Recurring in the sidebar, More › Recurring on phones) lists your schedules as Income, Expenses and Investments, with the next date and Paused ones last. **New schedule** asks for the type, amount, name, how often it repeats, the first date, a category, an optional account and (for expenses) your share, and shows the next dates before you save. A first date in the past records the missed dates at once. Open a schedule to see its next three dates and details, **Edit** it (future dates only; recorded entries keep their details), **Pause** or **Resume** it (paused dates are skipped), or **Remove schedule** (recorded entries stay). Changes save on this device first and show **Waiting to sync** until the server has them; dates follow the browser's local calendar.

## Sync and recurrence behavior

The app caches each signed-in personal ledger on the device. A personal entry, account, category, trip, or schedule change is persisted locally before it appears as saved. Pending changes survive app restarts and sync on reconnect, foregrounding, or the 15-second active interval. Sync fetches the latest server revision, merges changes to separate records and fields, and retries revision races up to four times. If both devices change the same field, this device's pending value wins. The sync banner shows when changes are waiting or a retry is needed. Signing out is blocked until pending personal changes sync. Shared household actions and receipt uploads still require a connection.

Recurring entries are materialized when a client syncs or saves, using that device's local calendar date. Missed dates catch up once. Monthly schedules retain their original day through short months (Jan 31 → Feb 28 → Mar 31). Pausing skips paused dates on resume. Deleting an occurrence does not regenerate it. Deleting a schedule preserves history. Editing an occurrence changes only that occurrence. Edit the schedule in **Recurring** to change its amount, account, category, next date or cadence; entries it already recorded keep their details. Attachments belong to individual occurrences and are not copied onto future entries.

Browsing the overview does not record future income or advance schedules. When a scheduled payment is materialized, its recorded occurrence replaces the preview without increasing the projected income again. Paused or removed schedules contribute no future income. For pay twice per month on fixed dates, use two monthly income schedules (for example, the 15th and the 31st; the 31st falls on the last day in shorter months).

## Ledger upgrades

Existing ledgers upgrade to version 4 on read and persist that version on the next save. Payment accounts and trips start empty when absent in older versions; historical entries stay unassigned. For version 1 ledgers, an Investments category is added unless one already exists or the 300-category limit is reached. Historical expenses retain their classification; edit an entry and select Investment to reclassify it. Editing a recurring occurrence does not change its schedule. Edit the recurring schedule to change future contributions or their payment account. Deploy the updated server alongside the client so payment accounts, trips and investment entries can be saved.


