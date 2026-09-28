# Household feature implementation plan

Penny currently saves each person's private ledger as a JSON snapshot. Shared expenses should be stored separately on the server and projected into each member's transaction list. That prevents one member's normal sync from overwriting another member's edits.

Each numbered item below is a separate task with a checkable result. Tasks are ordered by dependency.

## Foundation

| Task | Work | Done when |
| --- | --- | --- |
| **1. Write acceptance examples** | Capture examples for two and three members, exact and percentage splits, cent rounding, month boundaries, an overdue month, edited expenses, and reimbursements. | Each example states the expected personal share and who owes whom. |
| **2. Add the SQLite migration** | Add versioned tables for households, membership history, invite codes, shared expenses and splits, recurring rules, reimbursements, audit events, and push devices. | Existing private ledgers and receipts survive an upgrade and server restart. |
| **3. Define shared domain types** | Add household, member, expense, split, reimbursement, recurrence, and audit types outside the private `Ledger` snapshot. Give shared entries a distinct source and ID. | Private entries and shared entries cannot be confused or saved through the wrong API. |
| **4. Implement split calculations** | Use integer cents. Default to equal shares among all current members; support exact amounts and percentages. Assign rounding cents deterministically. | Every valid split sums exactly to the expense total, including amounts such as $100 split three ways. |
| **5. Implement monthly balance calculations** | Calculate each member's net position from that month's expenses and reimbursements, then suggest full transfers that settle the month with as few payments as practical. Keep months independent. | Unpaid January remains marked overdue in January and does not change February's suggested payments. |

## Server capabilities

| Task | Work | Done when |
| --- | --- | --- |
| **6. Add household authorization** | Centralize checks for active membership, historical read access, creator privileges, and the payer's private payment account. | Direct API calls cannot expose or change another household's data or another person's account. |
| **7. Build household lifecycle APIs** | Create, list, view, rename, and archive households; list members; enforce one household currency. Allow multiple household memberships. | The creator controls membership and cannot leave while other members remain. |
| **8. Build invite-code APIs** | Generate a code only when the creator taps Invite; expire it after ten minutes. Add authenticated join, code rotation, and attempt limits. | Expired, guessed, and cross-household codes cannot be used. |
| **9. Build membership exit rules** | Preserve a departed member in historical expenses while excluding them from future splits. Check every month for outstanding balances before permitting departure. | A member with an unpaid balance cannot leave; historical totals remain unchanged after someone leaves. |
| **10. Build shared-expense APIs** | Create, read, edit, and delete expenses with one payer and member splits. Use revisions to reject stale edits. Store shared category details so members with different private categories see the same expense. | Two members editing concurrently get a clear conflict instead of silently losing a change. |
| **11. Integrate private payment accounts** | Let only the payer assign one of their own accounts. Permit another member to enter the expense without choosing the payer's account. Clear the account if the payer changes; guard account deletion while linked. | Other members never receive the account name or ID in API responses. |
| **12. Share household receipts** | Extend receipt authorization so current members can view an expense's attachment. Preserve receipt access needed for historical entries after a member leaves. | Members can open the receipt; unrelated accounts cannot. |
| **13. Add the full audit trail** | Record actor, time, action, and before/after values for expense creation, edits, deletion, split changes, membership changes, and reimbursements. Preserve deleted records for audit purposes. | Members can inspect what changed, including changes made after a month was reimbursed. |
| **14. Build recurring household expenses** | Store household schedules on the server. Generate each occurrence once, using the members active on that date and recalculating its split. | A member who joins or leaves affects future occurrences without rewriting past ones. |
| **15. Build reimbursement APIs** | Record only a full suggested transfer, without confirmation or a payment-account choice. Keep reimbursements separate from expense transactions and reports. Recalculate a month if an expense is edited later. | A reimbursement reduces only its month's balance and has a visible audit record. |
| **16. Add a member-specific projection API** | Return each member's shared expense views with their own share and permitted account details. Keep these views out of the persisted private ledger. | A member sees household entries in their transaction feed and reports without duplicating them in JSON snapshots. |

## App experience

| Task | Work | Done when |
| --- | --- | --- |
| **17. Add household data and sync state** | Add household API calls and session-scoped state beside the existing ledger provider. Refresh on sign-in, foregrounding, and successful changes; clear on logout. | Switching accounts cannot display the previous user's households. |
| **18. Add household navigation and screens** | Add Expo Router routes for household list, creation, joining by code, member list, creator controls, and household detail. Support phone and web layouts. | A signed-in person can create and join households without using the demo ledger. |
| **19. Extend expense entry** | Add an optional household choice to expense entry, then payer and member splits. Keep private expenses and the existing personal split behavior working. Show account selection only to the payer. | Adding or editing a household expense updates every member's view correctly. |
| **20. Integrate personal reports** | Show each shared expense as a linked transaction and count the viewer's owed share in monthly totals, categories, calendar, search, and charts. Do not count reimbursements as spending. | A $90 expense split among three members adds $30 to each person's spending report. |
| **21. Build the monthly recap** | Show all household expenses for the selected month, member totals, suggested reimbursements, paid state, and older overdue months. | Members can distinguish February's balance from unpaid January at a glance. |
| **22. Build reimbursement and audit UI** | Let an involved member record a full suggested reimbursement without confirmation. Add a readable change-history view for each expense. | Recording a reimbursement updates the recap but adds no expense transaction. |

## Phone notifications

| Task | Work | Done when |
| --- | --- | --- |
| **23. Register devices** | Add `expo-notifications`, request permission, register and revoke device tokens per signed-in account, and handle notification taps with Expo Router. | A permitted phone can receive a notification that opens the relevant household item. |
| **24. Send notifications from the server** | Queue and retry pushes for **new expenses, edited expenses, and reimbursements**. Notify affected members other than the person performing the action; treat a generated recurring occurrence as a new expense. | A failed push does not undo a saved expense or produce duplicate alerts on retry. |

Expo SDK 57 supports this through `expo-notifications` and the Expo Push Service. It requires push credentials and a new mobile build; Android remote push is unavailable in Expo Go. See the [SDK 57 notifications reference](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) and [push setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## Verification and release

| Task | Work | Done when |
| --- | --- | --- |
| **25. Test the rules and API** | Add unit tests for splits, rounding, monthly netting, recurrence, and overdue balances; API tests for invitations, permissions, concurrent edits, receipts, departure, and audit history. | The cases from Task 1 pass against the real SQLite-backed API. |
| **26. Test the app workflows** | Cover create/join, shared entry and edit, personal reports, recap, reimbursement, denied notification permission, and account switching. Check iOS, Android, phone-width web, and desktop web. | The complete flow works across platforms without changing existing private-ledger behavior. |
| **27. Prepare migration and deployment** | Document database backup and restore, server-first deployment, push credentials, and new mobile builds. Update the README and feature limits. | An existing self-hosted installation can upgrade without losing data, and the release checklist is reproducible. |

## Delivery order

Complete Tasks 1–16 for trustworthy shared data, Tasks 17–22 for the usable feature, then Tasks 23–27 for notifications and release. Run lint, typecheck, and relevant tests at each stage.
