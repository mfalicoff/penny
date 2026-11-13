# Native accounts, categories and recurring schedules (MAZ-74)

[Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [Native app shell](ios-shell.md) · [Ledger rules](ios-ledger-domain.md) · [Offline sync](ios-offline-sync.md)

This page describes the organize pages of the SwiftUI app: payment accounts, categories and personal recurring schedules. They open from Settings › Manage on iPhone and from the sidebar's Manage section on iPad. Every change goes through the same path as any other ledger change (`LedgerChange` → `LedgerWorkspace.commit` → the MAZ-71 offline engine), so it is kept on the device first, works offline, shows the save toast and syncs later. The rules themselves were ported by MAZ-70 ([ledger rules](ios-ledger-domain.md)); this issue adds the screens, the forms and the tests around them.

## Where the code is

| Module | Files | What |
| --- | --- | --- |
| PennyDomain | `Ledger/Organize.swift` | `RecordUsage` and `Ledger.usage(ofAccount:)`/`usage(ofCategory:)`, `RecurringRule.upcomingDates(_:)`, `EntryDraft(schedule:)`, `EntryDraft.newSchedule`, `switchKind`, and `trimmed()` for accounts and categories |
| PennyDesign | `Components/CategoryPalette.swift` | The form's palette (`pickerColors`) and icons (`pickerIcons`), `hex(_:)`, `color(forCategoryID:hex:)` (how a stored color is drawn) and VoiceOver names |
| PennyUI | `Organize/OrganizeModels.swift` | `AccountFormModel`, `CategoryFormModel`, `ScheduleFormModel`, `ScheduleActions` and the wording (`OrganizeText`, `ScheduleText`) |
| PennyUI | `Organize/AccountViews.swift`, `CategoryViews.swift`, `RecurringViews.swift`, `ScheduleForm.swift` | Accounts, Categories, Recurring, the schedule page and the three form sheets |
| PennyUI | `Organize/OrganizeSpecimens.swift` | Xcode previews named after the specimens |

## Accounts

An account is a label for how money is paid or received: Bank account, Credit card, Cash or Other. Penny never connects to a bank and never shows a balance; each row shows the type and what uses it ("Credit card · 31 entries, 3 schedules", or "not used yet").

- **Name:** trimmed, 1–50 characters, unique ignoring case (`You already have an account with this name.`). At most 300 accounts.
- **Rename and retype** are always allowed, also while entries or schedules use the account.
- **Remove** is offered only when nothing uses the account, after a confirmation. While entries or schedules use it, the button is disabled with a lock and the reason: "Visa is used by 31 entries and 3 schedules. Move them to another account to remove it." The ledger rule refuses it as well (`This account has entries or schedules. Reassign them before deleting it.`), so a removal synced from another device is refused too. There is no bulk move: reassign entries one by one (MAZ-73's entry form) or edit the schedules here.
- A form opened on an account that then changed on another device is refused with `This account changed on another device. Reopen it before editing.`

## Categories

Categories are listed one kind at a time (Expense, Income, Investment), each with how many entries and schedules use it.

- **Name:** trimmed, 1–50 characters, unique ignoring case within its kind. At most 300 categories.
- **Color:** the form offers only the redesign's category palette (blue, teal, slate, pink, brown, olive, ocean, gray; `contracts/design-baseline.json` `categoryColors`), never a meaning color. It is stored as `#RRGGBB`, so the web app and the released Expo builds read it.
- **Icon:** a grid of icons, stored as their Ionicons names (`home-outline`) for the same reason, and drawn with the matching SF Symbol.
- **Kind** can change only while nothing uses the category (`This category has entries. Keep its type to preserve your history.`).
- **Remove** is offered only when nothing uses it; otherwise it is disabled with "Home is used by 14 entries. Keep it to preserve your history." Categories have no reassignment: they keep history.

**Legacy colors.** Older ledgers store the Expo palette (`#E47850`, `#C6953A`…). A category is drawn with its stored color when that is a redesign color; a default category (`home`, `food`…) otherwise keeps its own redesign color; any other legacy color maps to the redesign color of the default category that used it (`#E47850` → pink, `#C6953A` → blue, `#6C9C79` → teal, `#678DB1` → slate, `#9D83BA` → olive, `#C8798D` → brown); anything else is gray. Renaming a category without touching its color saves the stored color back unchanged. `CategoryStyle.color(forCategoryID:hex:)` implements this; Home and Activity rows still use the id-only `color(forCategoryID:)` until their owners switch.

## Recurring schedules

Recurring lists personal schedules under Income, Expenses and Investments: active ones by next date, then paused ones. A row shows the category, the title, "Monthly · next Nov 15 · Visa" (or a "Paused · monthly" chip) and the amount in its meaning color: income green with a plus, expenses in the label color with a minus, investments indigo; a paused amount is neutral. Swiping a row pauses or resumes it, or removes it after a confirmation. Tapping it opens the schedule's page.

**The schedule page** shows the amount, the cadence ("Every month on the 18th"; anchors after the 28th add "or the last day of shorter months"), **Edit** and a separate **Pause**/**Resume**, the next three dates (the first with "in 9 days"), the category, account, receipt total for a split, start date and note, and **Remove schedule** with its own confirmation ("Future entries stop. Entries already recorded stay in your activity."). A paused schedule says Penny won't record it until resumed, and lists the dates resuming today would give.

**Editing** (`ScheduleFormModel`, `EntryDraft.buildSchedule`) can change the kind, name, amount and your share, category, account (or none), next date, frequency and note. Rules:

- Editing changes future occurrences only. Entries the schedule already recorded keep their own amount, category and account (their ids are `{ruleId}:{date}`, so nothing is recorded twice).
- Keeping the next date keeps the anchor day, so a schedule on the 31st stays on the 31st after a short month. Moving it re-anchors the schedule on the new day. The first date (`date`) never changes.
- A schedule changed on another device since the form opened is refused (`This schedule changed on another device…`). A removed account or category is refused with the step to choose another.

**New schedules** from Recurring's + record their first date as an entry and start the rule after it, exactly like a repeating entry from Add entry (`EntryDraft.build`), so the first date is never recorded twice.

**Pause and resume.** Pausing keeps the next date and records nothing. Resuming skips every date up to today, so a pause never records the dates it covered. **Remove** deletes the rule only; recorded entries keep their `recurringId` and stay in Activity.

**Month ends.** Monthly and yearly schedules return to their anchor day: Jan 31 → Feb 28 (29 in leap years) → Mar 31; a yearly Feb 29 falls on Feb 28 in other years. Dates after 2100-12-31 are never listed.

## Reusable forms

`AccountFormSheet` and `CategoryFormSheet` are the canonical forms. Management pages present them, and any other form can present them inline without losing its own draft, because the draft stays in the presenting form's model while the sheet is open:

```swift
.sheet(isPresented: $addingAccount) {
    AccountFormSheet(type: .bank) { account in draft.accountId = account.id }
}
.sheet(isPresented: $addingCategory) {
    CategoryFormSheet(kind: draft.kind) { category in draft.categoryId = category.id }
}
```

- `onSaved` runs once, after the record is kept on the device (offline included), with the stored record (trimmed name, its new id), right before the sheet closes. It never runs on Cancel or a failed save.
- A failed save keeps the sheet open with what was typed and the reason; Try again reuses the same id, so no duplicate is created.
- `AccountFormSheet(account:)` and `CategoryFormSheet(category:)` edit an existing record and add Remove with its guard. Both need `ShellModel` in the environment.

The schedule form uses them for **New account…** and **New category…**: the new record is selected and every other field of the schedule draft is kept.

## Accessibility identifiers

Following the shell's `screen.*` and `<area>.<control>` convention:

| Screen | Identifiers |
| --- | --- |
| Accounts | `screen.accounts`, `accounts.add`, `account.<id>` |
| Account form | `screen.accountForm`, `accountForm.name`, `accountForm.type.<bank\|credit\|cash\|other>`, `accountForm.save`, `accountForm.cancel`, `accountForm.remove`, `accountForm.removeReason`, `accountForm.removeConfirm` |
| Categories | `screen.categories`, `categories.kind`, `categories.add`, `category.<id>` |
| Category form | `screen.categoryForm`, `categoryForm.name`, `categoryForm.kind`, `categoryForm.color.<palette name>`, `categoryForm.icon.<ionicon>`, `categoryForm.save`, `categoryForm.cancel`, `categoryForm.remove`, `categoryForm.removeReason`, `categoryForm.removeConfirm` |
| Recurring | `screen.recurring`, `recurring.add`, `schedule.<id>`, `schedule.<id>.toggle`, `schedule.<id>.remove` (swipe actions), `recurring.removeConfirm` |
| Schedule page | `screen.schedule`, `schedule.cadence`, `schedule.edit`, `schedule.toggleActive`, `schedule.pausedBanner`, `schedule.remove`, `schedule.removeConfirm` |
| Schedule form | `screen.scheduleForm`, `scheduleForm.kind`, `scheduleForm.title`, `scheduleForm.amount`, `scheduleForm.split`, `scheduleForm.share`, `scheduleForm.category`, `scheduleForm.newCategory`, `scheduleForm.account`, `scheduleForm.newAccount`, `scheduleForm.date`, `scheduleForm.frequency`, `scheduleForm.note`, `scheduleForm.save`, `scheduleForm.cancel` |

The save error banner (`banner.saveError`), toast (`toast.saved`) and states (`state.*`) are the shell's.

## Specimens

The previews in `PennyUI/Organize/OrganizeSpecimens.swift` use made-up data:

| Specimen (MAZ-74) | Card | Preview |
| --- | --- | --- |
| more | `iphone-settings` (Manage) | `more (iphone-settings, Manage)` |
| accounts | `iphone-accounts` | `iphone-accounts` |
| account-form | `iphone-account-form` | `iphone-account-form (new)` |
| account-edit | `iphone-account-form` | `account-edit (in use)` |
| categories | `iphone-categories` | `iphone-categories` |
| category-form | `iphone-category-form` | `iphone-category-form` |
| recurring | `iphone-recurring` | `iphone-recurring` |
| recurring-paused, schedule | `iphone-schedule-detail` | `recurring-paused (schedule)`, `iphone-schedule-detail` |
| edit-schedule | (sheet from `iphone-schedule-detail`) | `edit-schedule`, `edit-schedule (save error keeps the draft)` |
| remove-schedule | (confirmation on `iphone-schedule-detail`) | the Remove schedule confirmation in either schedule preview |

Not built from the cards: the categories card's **Edit / Drag to reorder** (the ledger has no category order command, and MAZ-134 orders Add entry shortcuts by recent use instead) and bulk reassignment of an account's entries.

## Tests

- `OrganizeTests` (PennyDomain): usage counts; account removal refused when linked to entries or only to schedules; renaming an account in use; category removal and kind change refused when in use; every account type; untouched schedule drafts rebuilding the same rule (split, month-end, weekly); re-anchoring; invalid drafts with the legacy messages; kind switching; new schedules recording the first date; edits keeping recorded occurrences while future ones use the new values; stale schedule edits; removed accounts; pause/resume skipping paused dates; removal keeping history; month-end, leap-year and 2100 upcoming dates.
- `CategoryPaletteTests` (PennyDesign): palette hex against the baseline, stored and legacy color resolution, every icon having its own SF Symbol.
- `OrganizeFormTests` (PennyUI): new and edited accounts and categories through `FixedWorkspace`; a failed save keeping the draft and retrying with the same id; duplicate names; in-use removal refused with the reason; stale edits; legacy colors saved back unchanged; schedule editing, creation, invalid drafts and storage failures keeping the draft; inline account and category creation keeping the schedule draft; pause/resume and the paused preview; removal keeping history; cadence, ordering and row wording.
- `OrganizeOfflineTests` (PennyData): an account, a category, a schedule edit and a pause saved offline are on disk, survive a relaunch and reach the fake server on reconnect; an in-use account removal offline is refused and keeps nothing pending.

Not automated here: XCUITest CRUD, pause and resume journeys, Dynamic Type, dark mode and iPad screenshots (MAZ-81/82), and visual comparison with the cards (MAZ-122).
