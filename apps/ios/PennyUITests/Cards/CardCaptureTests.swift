import Foundation
import PennyAccessibility
import XCTest

private typealias Households = AccessibilityID.Households
private typealias Trips = AccessibilityID.Trips

/// The native app in the state of each redesign card (MAZ-122, TestPlans/Cards.xctestplan):
/// every `iphone-*` card on the iPhone simulator and every `ipad-*` card on the iPad simulator,
/// seeded from contracts/fixtures/redesign-states.json, captured as `card-<id>-<appearance>`
/// next to the baselines in docs/design/penny-ios/previews. `ios.sh ui-test cards` exports the
/// captures and test-results/cards/ios/report.json (`scripts/card-report.mjs`). `web-*` cards and
/// `system-foundations` are not native screens; the report marks them not applicable.
final class CardCaptureTests: CardTestCase {
    // MARK: System

    @MainActor
    func test_whenOnTheHomeScreen_SystemWidgets_ShouldBeRecorded() async throws {
        guard !Device.isPad else { throw XCTSkip("system-widgets is recorded on the iPhone run") }
        try notBuilt(
            "system-widgets",
            note:
                "The widgets exist (PennyWidgets, MAZ-80) but XCUITest cannot add them to the Home or Lock Screen; "
                + "captured in WidgetKit previews and the device checklist (docs/ios/qa.md)")
    }

    // MARK: iPhone overview

    @MainActor
    func test_whenSeeded_IphoneHome_ShouldBeCaptured() async throws {
        try await card("iphone-home") { card in try card.penny.wait(for: AccessibilityID.Home.hero) }
    }

    @MainActor
    func test_whenSeeded_IphoneHomeDark_ShouldBeCaptured() async throws {
        try await card("iphone-home-dark") { card in try card.penny.wait(for: AccessibilityID.Home.hero) }
    }

    @MainActor
    func test_whenSeeded_IphoneHomeExplore_ShouldBeCaptured() async throws {
        try await card("iphone-home-explore") { card in
            try card.penny.wait(for: AccessibilityID.Home.expectedIncome)
            // Scrolled to the end of Home: Expected income and Explore your month above the tab bar.
            let last = try card.penny.wait(for: AccessibilityID.Home.exploreMoneyFlow)
            let origin = card.app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            for _ in 0..<4 where last.frame.maxY > card.app.frame.height - 100 {
                // A drag on the left of the page, clear of the scroll indicator and the tab bar.
                origin.withOffset(CGVector(dx: 60, dy: 640)).press(
                    forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: 60, dy: 240)),
                    withVelocity: .slow, thenHoldForDuration: 0.3)
            }
            guard last.frame.maxY <= card.app.frame.height - 100 else {
                throw UIExpectationFailed(description: "Explore your month stayed under the tab bar")
            }
        }
    }

    @MainActor
    func test_whenSeeded_IphoneHomeOverspent_ShouldBeCaptured() async throws {
        try await card("iphone-home-overspent") { card in try card.penny.wait(for: AccessibilityID.Home.hero) }
    }

    @MainActor
    func test_whenSeeded_IphoneMoneyFlow_ShouldBeCaptured() async throws {
        try await card("iphone-money-flow") { card in
            try card.penny.selectMonth("September 2026")
            try card.penny.tap(AccessibilityID.Home.flow)
            try card.penny.wait(for: AccessibilityID.Screen.moneyFlow)
            try card.penny.wait(for: AccessibilityID.Overview.flowChart)
            // The card focuses the largest spending band (Home), with its focus card.
            try card.penny.tap(AccessibilityID.Overview.flowNode("expense:home"))
            // The focus card, the hint and Show as a table above the floating tab bar, as on the card.
            try card.penny.reveal(AccessibilityID.Overview.flowTable, above: card.app.frame.height - 120)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneInsights_ShouldBeCaptured() async throws {
        try await card("iphone-insights") { card in
            // The flow card's Insights pill, as on the home card (MAZ-254).
            try card.penny.tap(AccessibilityID.Home.insights)
            try card.penny.wait(for: AccessibilityID.Screen.insights)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCalendar_ShouldBeCaptured() async throws {
        try await card("iphone-calendar") { card in
            // The calendar is a sheet over Home, from its toolbar button (MAZ-254).
            try card.penny.tap(AccessibilityID.Home.calendar)
            try card.penny.wait(for: AccessibilityID.Screen.calendar)
            try card.penny.wait(for: AccessibilityID.Overview.calendarGrid)
            // The card selects a past day with entries: Oct 3, the ETF purchase.
            try card.penny.tap(AccessibilityID.Overview.day("2026-10-03"))
            try card.penny.wait(for: AccessibilityID.Overview.calendarDayEntries)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEmptyHome_ShouldBeCaptured() async throws {
        try await card("iphone-empty-home") { card in try card.penny.wait(for: AccessibilityID.Home.empty) }
    }

    // MARK: iPhone activity and entries

    @MainActor
    func test_whenSeeded_IphoneActivity_ShouldBeCaptured() async throws {
        try await card("iphone-activity") { card in
            try card.penny.openActivity()
            try card.penny.waitForEntry("p-coffee-2")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneSearchEmpty_ShouldBeCaptured() async throws {
        try await card("iphone-search-empty") { card in
            try card.penny.openActivity()
            // The card narrows to Expenses in the month ("Nothing matches in October expenses",
            // with Search all months and Clear filters).
            try card.penny.tap(AccessibilityID.Activity.kindFilter("expense"))
            try card.penny.waitForSelection(AccessibilityID.Activity.kindFilter("expense"))
            // Return submits the search and puts the keyboard away, as on the card.
            try card.penny.search((card.state.search ?? "zzzz") + "\n")
            try card.penny.wait(for: AccessibilityID.Activity.searchEmpty, timeout: 30)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAddExpense_ShouldBeCaptured() async throws {
        try await card("iphone-add-expense", freshSeedPerAppearance: true) { card in
            // The card's draft: on Visa, split 3 ways.
            try card.penny.draftEntry()
            try card.penny.chooseAccount("card")
            // The form stays scrolled up so Account and Split show above the iPhone keypad.
            try card.penny.splitEqually(people: 3)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAddIncome_ShouldBeCaptured() async throws {
        try await card("iphone-add-income", freshSeedPerAppearance: true) { card in
            // The card's pay is dated after today, so it shows the amber "expected" callout.
            try card.penny.draftEntry(kind: "Income", amount: "3200.00", title: "Payday")
            try card.penny.chooseAccount("chq")
            try card.penny.chooseDate(month: "October", day: 30)
            // The iPhone keypad stays up: scroll the callout above it.
            let keypad = card.penny.element(AccessibilityID.EntryForm.keypad("1"))
            try card.penny.reveal(
                "entryForm.futureDate", above: keypad.exists ? keypad.frame.minY : card.app.frame.height)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEntryExtras_ShouldBeCaptured() async throws {
        try await card("iphone-entry-extras", freshSeedPerAppearance: true) { card in
            try card.penny.draftEntry()
            try card.penny.tapFormRow(AccessibilityID.Receipt.moreDetails, opening: AccessibilityID.Screen.entryExtras)
            // The card has a photo receipt attached (the photo `ios.sh` seeds in the library).
            try card.penny.pickPhoto()
            try card.penny.waitForAttachedReceipt()
        }
    }

    @MainActor
    func test_whenSeeded_IphoneSplit_ShouldBeCaptured() async throws {
        try await card("iphone-split", freshSeedPerAppearance: true) { card in
            try card.penny.draftEntry()
            // The card splits equally between 3 people, still open.
            try card.penny.splitEqually(people: 3, apply: false)
            try card.penny.wait(for: AccessibilityID.Cards.splitShare)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCategoryPicker_ShouldBeCaptured() async throws {
        try await card("iphone-category-picker", freshSeedPerAppearance: true) { card in
            try card.penny.openAddEntry()
            try card.penny.tap(AccessibilityID.Cards.moreCategories)
            try card.penny.wait(for: AccessibilityID.Screen.categoryPicker)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEntryDetail_ShouldBeCaptured() async throws {
        try await card("iphone-entry-detail") { card in
            // The card's entry has a photo receipt.
            try await card.attachReceipt(to: "p-party")
            try card.penny.openSeptemberEntry("p-party", withReceipt: true)
            // Above the floating tab bar, as on the card.
            try card.penny.reveal(AccessibilityID.Receipt.detailRow, above: card.app.frame.height - 130, partly: true)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneReceipt_ShouldBeRecorded() async throws {
        try await card("iphone-receipt") { _ in }
    }

    @MainActor
    func test_whenSeeded_IphoneDeleteConfirm_ShouldBeCaptured() async throws {
        try await card("iphone-delete-confirm") { card in
            // The shared Internet expense, swiped in Activity (MAZ-255).
            let seed = try card.seeded()
            let internet = "household:\(try seed.household("maison")):\(try seed.expense("internet"))"
            try card.penny.openActivity()
            try card.penny.waitForEntry(internet).swipeLeft()
            try card.penny.tap(AccessibilityID.Journeys.rowDelete)
            _ = try card.penny.dialogButton("Delete for everyone")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEditEntry_ShouldBeCaptured() async throws {
        try await card("iphone-edit-entry") { card in
            try card.penny.openSeptemberEntry("p-party")
            try card.penny.tap(AccessibilityID.Journeys.detailEdit)
            try card.penny.wait(for: AccessibilityID.Screen.editEntry)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAccountPicker_ShouldBeCaptured() async throws {
        try await card("iphone-account-picker", freshSeedPerAppearance: true) { card in
            try card.penny.openAddEntry()
            try card.penny.tapFormRow(AccessibilityID.EntryForm.account, opening: AccessibilityID.Screen.accountPicker)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneHouseholdPicker_ShouldBeCaptured() async throws {
        try await card(
            "iphone-household-picker", freshSeedPerAppearance: true,
            note: "Household is a row of More details (iphone-entry-extras), so the picker opens over that page"
        ) { card in
            try card.penny.draftEntry()
            try card.penny.tapFormRow(AccessibilityID.Receipt.moreDetails, opening: AccessibilityID.Screen.entryExtras)
            try card.penny.tap(AccessibilityID.EntryForm.household)
            try card.penny.wait(for: "screen.householdPicker")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneActivityFilters_ShouldBeCaptured() async throws {
        try await card("iphone-activity-filters") { card in
            try card.penny.openActivity()
            try card.penny.tap(AccessibilityID.Activity.kindFilter("expense"))
            try card.penny.waitForSelection(AccessibilityID.Activity.kindFilter("expense"))
            try card.penny.tap(AccessibilityID.Activity.filters)
            try card.penny.wait(for: "screen.activityFilters")
        }
    }

    @MainActor
    func test_whenSearchIsSlow_IphoneActivitySearching_ShouldBeCaptured() async throws {
        try await card("iphone-activity-searching", freshSeedPerAppearance: true) { card in
            // The server search is held back, so the search is still running.
            try await card.applyFault()
            try card.penny.openActivity()
            try card.penny.search(card.state.search ?? "coffee")
            try card.penny.wait(for: "activity.searching", timeout: 15)
        }
    }

    // MARK: iPhone households

    @MainActor
    func test_whenSeeded_IphoneSharedList_ShouldBeCaptured() async throws {
        try await card("iphone-shared-list") { card in
            let maison = try card.seeded().household("maison")
            try card.penny.openShared()
            try card.penny.waitAfterRefresh(for: Households.row(maison), on: AccessibilityID.Screen.shared)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneShared_ShouldBeCaptured() async throws {
        try await card("iphone-shared") { card in try card.penny.openHousehold(card.seeded().household("maison")) }
    }

    @MainActor
    func test_whenSeeded_IphoneSharedBalances_ShouldBeCaptured() async throws {
        try await card("iphone-shared-balances") { card in
            try card.penny.openHousehold(card.seeded().household("maison"))
            try card.penny.selectSegment("Balances", in: Households.section)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneSharedPeople_ShouldBeCaptured() async throws {
        try await card("iphone-shared-people") { card in
            let seed = try card.seeded()
            try card.penny.openHousehold(seed.household("maison"))
            try card.penny.selectSegment("People", in: Households.section)
            try card.penny.wait(for: Households.member(seed.userIDs["bea"] ?? ""))
        }
    }

    @MainActor
    func test_whenSeeded_IphoneSharedExpenseAdd_ShouldBeCaptured() async throws {
        try await card("iphone-shared-expense-add") { card in
            try card.penny.openHousehold(card.seeded().household("maison"))
            try card.penny.tap(Households.addExpense, opening: Households.Screen.expenseForm)
            // The card's draft: $96.30 Hydro, paid by the other member.
            try card.penny.enterAmount("96.30", into: Households.formAmount)
            try card.penny.type("Hydro", into: Households.formTitle)
            // Tapping the amount puts the keyboard away (it clears the form's focus).
            try card.penny.tap(Households.formAmount)
            _ = card.app.keyboards.firstMatch.waitForNonExistence(timeout: 5)
            try card.penny.tap(Households.payer(card.seeded().userIDs["bea"] ?? ""))
        }
    }

    @MainActor
    func test_whenSeeded_IphoneRecordPayment_ShouldBeCaptured() async throws {
        try await card("iphone-record-payment") { card in try card.penny.openRecordShare(card.seeded()) }
    }

    @MainActor
    func test_whenSeeded_IphonePaymentStale_ShouldBeCaptured() async throws {
        try await card("iphone-payment-stale", freshSeedPerAppearance: true) { card in
            try card.penny.openRecordShare(card.seeded())
            // The other device records the same share first, on the revision this one read.
            try await card.performStaleWrite(as: card.state.alias ?? "bea", acceptedOnly: true)
            try card.penny.tap(Households.recordShareConfirm)
            try card.penny.wait(for: Households.Screen.paymentStale, timeout: 20)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneHouseholdCreate_ShouldBeCaptured() async throws {
        try await card("iphone-household-create") { card in
            try card.penny.openShared()
            try card.penny.tap(Households.create, opening: Households.Screen.start)
            // Return only ends editing here (no submit action).
            try card.penny.type("Apartment\n", into: Households.name)
            _ = card.app.keyboards.firstMatch.waitForNonExistence(timeout: 5)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneHistory_ShouldBeCaptured() async throws {
        try await card("iphone-history") { card in
            try card.penny.openHousehold(card.seeded().household("maison"))
            try card.penny.tap(Households.history, orIn: Households.more, opening: Households.Screen.history)
        }
    }

    // MARK: iPhone drafted household and trip cards (MAZ-238, built in MAZ-256)

    @MainActor
    func test_whenSeeded_IphoneSharedExpenseDetail_ShouldBeCaptured() async throws {
        try await card("iphone-shared-expense-detail") { card in
            let seed = try card.seeded()
            try card.penny.openHousehold(seed.household("maison"))
            try card.penny.tap(
                Households.expense(seed.expense("internet")), opening: AccessibilityID.Screen.householdExpense)
            try card.penny.wait(for: Households.share(seed.userIDs["bea"] ?? ""), timeout: 20)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneJoinCode_ShouldBeCaptured() async throws {
        try await card("iphone-join-code") { card in
            try card.penny.openShared()
            try card.penny.tap(Households.join, opening: Households.Screen.start)
            // The card's typed code; the keyboard is platform chrome.
            try card.penny.type("7F3A9C01B2", into: Households.code)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneInvite_ShouldBeCaptured() async throws {
        try await card("iphone-invite") { card in
            try card.penny.openHousehold(card.seeded().household("maison"))
            try card.penny.tap(Households.invite, orIn: Households.more, opening: Households.Screen.invite)
            try card.penny.wait(for: Households.inviteQR, timeout: 20)
        }
    }

    // MARK: iPhone email (MAZ-124)

    @MainActor
    func test_whenTheServerSendsEmail_IphoneInviteEmail_ShouldBeCaptured() async throws {
        guard try await stack().sendsEmail() else {
            return try blocked("iphone-invite-email", note: Self.needsSMTP)
        }
        try await card("iphone-invite-email") { card in
            let seed = try card.seeded()
            let token = try seed.user(card.state.alias ?? "alex").token
            let household = try seed.household("maison")
            // The card's two invitations: one sent days ago whose link expired (72 hours), and one
            // sent today, still waiting. Only once: the second appearance reuses the seed.
            if card.appearance == card.state.appearances.first {
                try await card.stack.setClock("2026-10-11T09:00:00Z")
                try await card.stack.emailInvite(token: token, household: household, email: "alex.k@example.test")
                try await card.stack.setClock(Stack.defaultNow)
                try await card.stack.emailInvite(token: token, household: household, email: "jo.s@example.test")
            }
            try card.penny.openHousehold(household)
            try card.penny.tap(Households.invite, orIn: Households.more, opening: Households.Screen.inviteEmail)
            try card.penny.wait(for: Households.inviteEmailShareCode, timeout: 20)
            guard card.app.staticTexts["alex.k@example.test"].waitForExistence(timeout: 20) else {
                throw UIExpectationFailed(description: "The invitations didn't load")
            }
            try card.penny.type("sam@example.test", into: Households.inviteEmailAddress)
        }
    }

    @MainActor
    func test_whenTheServerSendsEmail_IphoneForgotPassword_ShouldBeCaptured() async throws {
        guard try await stack().sendsEmail() else {
            return try blocked("iphone-forgot-password", note: Self.needsSMTP)
        }
        try await card("iphone-forgot-password") { card in
            let solo = try card.seeded().user(card.state.alias ?? "solo")
            try card.penny.type(solo.email, into: AccessibilityID.Auth.email)
            try card.penny.tap(AccessibilityID.Auth.forgotPassword)
            try card.penny.wait(for: AccessibilityID.Screen.forgotPassword)
            try card.penny.tap(AccessibilityID.Auth.sendResetLink)
            try card.penny.wait(for: AccessibilityID.Auth.resetSent, timeout: 20)
            card.penny.hideKeyboard()
        }
    }

    private static let needsSMTP =
        "Needs a stack that sends email: PENNY_STACK_SMTP=1 scripts/ios.sh ui-test cards (penny-env --smtp)"

    @MainActor
    func test_whenSeeded_IphoneTripPersonal_ShouldBeCaptured() async throws {
        try await card("iphone-trip-personal") { card in
            try card.penny.openTrips()
            try card.penny.tap(AccessibilityID.Row.trip("t-quebec"), opening: AccessibilityID.Screen.trip)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneTripShare_ShouldBeCaptured() async throws {
        try await card("iphone-trip-share") { card in
            try card.penny.openTrips()
            try card.penny.tap(AccessibilityID.Row.trip("t-quebec"), opening: AccessibilityID.Screen.trip)
            try card.penny.tap(Trips.share, opening: Trips.Screen.share)
        }
    }

    // MARK: iPhone trips

    @MainActor
    func test_whenSeeded_IphoneTrips_ShouldBeCaptured() async throws {
        try await card("iphone-trips") { card in
            try card.penny.openTrips()
            _ = try card.penny.lisbonRow(card.seeded())
            try card.penny.wait(for: AccessibilityID.Row.trip("t-quebec"))
        }
    }

    @MainActor
    func test_whenSeeded_IphoneTripDetail_ShouldBeCaptured() async throws {
        try await card("iphone-trip-detail") { card in try card.penny.openLisbon(card.seeded()) }
    }

    @MainActor
    func test_whenSeeded_IphoneTripForm_ShouldBeCaptured() async throws {
        try await card("iphone-trip-form") { card in
            try card.penny.openTrips()
            try card.penny.tap(Trips.new, opening: Trips.Screen.form)
            // The card names the trip and turns sharing on (You · Organizer, Invite people).
            // Return only ends editing here (no submit action).
            try card.penny.type("Lisbon\n", into: Trips.formName)
            _ = card.app.keyboards.firstMatch.waitForNonExistence(timeout: 5)
            try card.penny.turnOn(Trips.formShare)
        }
    }

    // MARK: iPhone settings

    @MainActor
    func test_whenSeeded_IphoneSettings_ShouldBeCaptured() async throws {
        try await card("iphone-settings", freshSeedPerAppearance: true, followsSystem: true, standInFaceID: true) {
            card in
            try card.penny.turnOnAppLock()
            try card.penny.openSettings()
        }
    }

    @MainActor
    func test_whenSeeded_IphoneRecurring_ShouldBeCaptured() async throws {
        try await card("iphone-recurring") { card in
            try card.penny.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
            try card.penny.wait(for: AccessibilityID.Organize.schedule("r-gym"))
            // The household's shared Streaming (MAZ-198); its id is the server's.
            let shared = card.penny.app.buttons
                .matching(NSPredicate(format: "identifier BEGINSWITH %@", AccessibilityID.Organize.sharedSchedule("")))
                .firstMatch
            guard shared.waitForExistence(timeout: Penny.timeout) else {
                throw UIExpectationFailed(description: "the shared Streaming schedule did not appear")
            }
        }
    }

    @MainActor
    func test_whenSeeded_IphoneScheduleDetail_ShouldBeCaptured() async throws {
        try await card("iphone-schedule-detail") { card in
            try card.penny.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
            try card.penny.tap(AccessibilityID.Organize.schedule("r-gym"), opening: AccessibilityID.Screen.schedule)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAccounts_ShouldBeCaptured() async throws {
        try await card("iphone-accounts") { card in
            try card.penny.openSettingsPage("accounts", screen: AccessibilityID.Screen.accounts)
            try card.penny.wait(for: AccessibilityID.Organize.account("chq"))
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAccountForm_ShouldBeCaptured() async throws {
        try await card("iphone-account-form") { card in
            try card.penny.openSettingsPage("accounts", screen: AccessibilityID.Screen.accounts)
            // The card edits Visa, which entries and schedules use, so it offers Move and remove.
            try card.penny.tap(AccessibilityID.Organize.account("card"), opening: AccessibilityID.Screen.accountForm)
            try card.penny.wait(for: "accountForm.removeReason")
            try card.penny.wait(for: "accountForm.moveAndRemove")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCategories_ShouldBeCaptured() async throws {
        try await card("iphone-categories") { card in
            try card.penny.openSettingsPage("categories", screen: AccessibilityID.Screen.categories)
            try card.penny.wait(for: AccessibilityID.Organize.category("food"))
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCategoryForm_ShouldBeCaptured() async throws {
        try await card("iphone-category-form") { card in
            try card.penny.openSettingsPage("categories", screen: AccessibilityID.Screen.categories)
            try card.penny.tap(AccessibilityID.Organize.addCategory, opening: AccessibilityID.Screen.categoryForm)
            // The card's draft: Coffee, with the cup icon in the food color, and no keyboard:
            // Return puts the keyboard away without saving.
            try card.penny.tap("categoryForm.color.food")
            try card.penny.tap("categoryForm.icon.cafe-outline")
            try card.penny.type("Coffee\n", into: AccessibilityID.Organize.categoryName)
            guard card.penny.app.keyboards.firstMatch.waitForNonExistence(timeout: 3) else {
                throw UIExpectationFailed(description: "Return did not put the keyboard away")
            }
            // Back to the top, where the card shows the preview over the name.
            card.penny.app.collectionViews.firstMatch.swipeDown()
            try card.penny.wait(for: AccessibilityID.Screen.categoryForm)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAppearance_ShouldBeCaptured() async throws {
        try await card("iphone-appearance", followsSystem: true) { card in
            try card.penny.openSettingsPage("appearance", screen: AccessibilityID.Screen.appearance)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAppLock_ShouldBeCaptured() async throws {
        try await card(
            "iphone-app-lock", freshSeedPerAppearance: true, standInFaceID: true,
            note: "The simulator has no enrolled Face ID: the Debug stand-in answers it, so the lock can be on"
        ) { card in
            try card.penny.turnOnAppLock(closing: false)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneLock_ShouldBeRecorded() async throws {
        try blocked(
            "iphone-lock",
            note:
                "The lock cover needs the Face ID lock turned on, which needs enrolled, matching Face ID; XCUITest "
                + "cannot enroll or match biometrics (device checklist, docs/ios/qa.md)")
    }

    @MainActor
    func test_whenSeeded_IphoneSignOut_ShouldBeCaptured() async throws {
        try await card("iphone-sign-out", freshSeedPerAppearance: true) { card in
            // The card has two changes the server hasn't taken.
            try await card.makeTwoPendingChanges(FaultRule(method: "PUT", pathPrefix: "/api/ledger", abort: true))
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Auth.signOut)
            _ = try card.penny.dialogButton("Sync, then sign out")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneSignOutPlain_ShouldBeCaptured() async throws {
        try await card("iphone-sign-out-plain") { card in
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Auth.signOut)
            _ = try card.penny.dialogButton("Cancel")
            try card.penny.wait(for: "screen.signOutConfirm")
        }
    }

    // MARK: iPhone profile (MAZ-171, MAZ-169)

    @MainActor
    func test_whenSeeded_IphoneProfile_ShouldBeCaptured() async throws {
        try await card("iphone-profile") { card in
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Settings.account, opening: AccessibilityID.Profile.screen)
            try card.penny.wait(for: AccessibilityID.Profile.changePassword)
            // The Sign-in row reads as one element: its email, how it signs in and Verified.
            guard
                try card.penny.wait(for: AccessibilityID.Profile.signIn).waitForLabel(
                    containing: "Verified", timeout: 20)
            else { throw UIExpectationFailed(description: "The Sign-in row has no Verified mark") }
            try card.penny.wait(for: AccessibilityID.AccountData.deleteRow)
        }
    }

    // MARK: iPhone Your data (MAZ-152)

    @MainActor
    func test_whenSeeded_IphoneDeleteAccount_ShouldBeCaptured() async throws {
        try await card("iphone-delete-account") { card in
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Settings.account, opening: AccessibilityID.Profile.screen)
            try card.penny.tap(AccessibilityID.AccountData.deleteRow, opening: AccessibilityID.AccountData.deleteScreen)
            // Stays for others lists the seeded household once the list has loaded.
            try card.penny.wait(for: AccessibilityID.AccountData.deleteStays, timeout: 20)
            try card.penny.wait(for: AccessibilityID.AccountData.deleteConfirm)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneExportAll_ShouldBeCaptured() async throws {
        try await card("iphone-export-all") { card in
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Settings.account, opening: AccessibilityID.Profile.screen)
            try card.penny.tap(AccessibilityID.AccountData.exportRow, opening: AccessibilityID.AccountData.exportScreen)
            try card.penny.wait(for: AccessibilityID.AccountData.exportFile, timeout: 60)
            try card.penny.wait(for: AccessibilityID.AccountData.exportShare)
        }
    }

    // MARK: iPhone email verification (MAZ-172)

    @MainActor
    func test_whenTheServerSendsEmail_IphoneVerifyEmail_ShouldBeCaptured() async throws {
        guard try await stack().sendsEmail() else {
            return try blocked("iphone-verify-email", note: Self.needsSMTP)
        }
        try await card("iphone-verify-email", note: Self.newAccountNote) { card in
            let penny = try await signUpFresh(card)
            try penny.wait(for: AccessibilityID.EmailVerification.resend)
        }
    }

    @MainActor
    func test_whenTheServerSendsEmail_IphoneUnverified_ShouldBeCaptured() async throws {
        guard try await stack().sendsEmail() else {
            return try blocked("iphone-unverified", note: Self.needsSMTP)
        }
        try await card("iphone-unverified", note: Self.newAccountNote) { card in
            let penny = try await signUpFresh(card)
            try penny.tap(AccessibilityID.EmailVerification.continueToPenny)
            try penny.waitForShell()
            try penny.openShared()
            try penny.wait(for: AccessibilityID.EmailVerification.reminder, timeout: 20)
            try penny.wait(for: AccessibilityID.Households.create)
        }
    }

    private static let newAccountNote =
        "A new account signed up in the app (the seeded accounts are verified, as every account from before "
        + "verification is), so the address is the run's own instead of the card's"

    /// A fresh install that signs up a new password account and stops on Check your email.
    @MainActor
    private func signUpFresh(_ card: CardContext) async throws -> Penny {
        var options = LaunchOptions()
        options.seed = ContainerSeed(standardDefaults: ["penny.appearance": card.appearance])
        let penny = try await launch(options)
        try penny.wait(for: AccessibilityID.Auth.email, timeout: 30)
        try penny.tap(AccessibilityID.Auth.switchMode)
        try penny.type("Max Falicoff", into: AccessibilityID.Profile.signUpName)
        let email = "max.\(UUID().uuidString.prefix(6).lowercased())@example.test"
        try penny.type(email, into: AccessibilityID.Auth.email)
        try penny.type("penny-card-pass-\(UUID().uuidString.prefix(6))", into: AccessibilityID.Auth.password)
        try penny.tap(AccessibilityID.Auth.createAccount)
        try penny.wait(for: AccessibilityID.EmailVerification.checkEmailScreen, timeout: 30)
        penny.dismissSavePassword(timeout: 3)
        return penny
    }

    @MainActor
    func test_whenSeeded_IphoneProfileProvider_ShouldBeRecorded() async throws {
        try blocked(
            "iphone-profile-provider",
            note:
                "The full-stack seeds have no account that signs in with a provider; the read-only profile is "
                + "covered by the PennyData profile tests")
    }

    @MainActor
    func test_whenSeeded_IphoneProfilePhoto_ShouldBeCaptured() async throws {
        try await card("iphone-profile-photo", freshSeedPerAppearance: true) { card in
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Settings.account, opening: AccessibilityID.Profile.screen)
            try card.penny.tap(AccessibilityID.Profile.changePicture)
            // The system photo picker: the first of the simulator's sample photos.
            let photo = card.app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
            guard photo.waitForExistence(timeout: 20) else {
                throw UIExpectationFailed(description: "the photo picker showed no photo")
            }
            photo.tap()
            try card.penny.wait(for: AccessibilityID.Profile.cropScreen, timeout: 20)
            try card.penny.wait(for: AccessibilityID.Profile.cropChoose)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneNamePrompt_ShouldBeCaptured() async throws {
        try await card("iphone-name-prompt", freshSeedPerAppearance: true) { card in
            try card.penny.wait(for: AccessibilityID.Home.hero)
            // The card's account has no name yet: clear alex's, then come back to Penny, which
            // reads the profile again and asks.
            let alex = try card.seeded().user(card.state.alias ?? "alex")
            try await card.stack.setDisplayName(nil, token: alex.token)
            XCUIDevice.shared.press(.home)
            card.app.activate()
            try card.penny.wait(for: AccessibilityID.Profile.namePromptScreen, timeout: 20)
            try card.penny.type("Max", into: AccessibilityID.Profile.promptName)
            card.penny.hideKeyboard()
        }
    }

    // MARK: iPhone signed out

    @MainActor
    func test_whenSignedOut_IphoneSignIn_ShouldBeCaptured() async throws {
        // The card has the server's single sign-on only; with Apple and Google listed the
        // providers lead instead (iphone-sign-in-providers).
        if try await stack().listsAppleAndGoogle() {
            return try blocked("iphone-sign-in", note: Self.needsSingleSignOnOnly)
        }
        try await card("iphone-sign-in") { card in
            try await typeSignInEmail(card)
        }
    }

    /// Types the seeded email on sign-in and puts the keyboard away, as the sign-in cards show it.
    @MainActor
    private func typeSignInEmail(_ card: CardContext) async throws {
        let solo = try card.seeded().user(card.state.alias ?? "solo")
        try card.penny.type(solo.email, into: AccessibilityID.Auth.email)
        dragKeyboardAway(card)
        try card.penny.wait(for: AccessibilityID.Auth.tryDemo)
    }

    /// The signed-out forms have no tap-to-dismiss, and a tap could land on a provider button
    /// (MAZ-170): drag the form down into the keyboard (interactive dismiss) instead.
    @MainActor
    private func dragKeyboardAway(_ card: CardContext) {
        if card.app.keyboards.firstMatch.exists {
            card.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
                .press(
                    forDuration: 0.05,
                    thenDragTo: card.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)))
            _ = card.app.keyboards.firstMatch.waitForNonExistence(timeout: 3)
        }
    }

    // MARK: iPhone sign-in providers (MAZ-170)

    @MainActor
    func test_whenTheServerListsAppleAndGoogle_IphoneSignInProviders_ShouldBeCaptured() async throws {
        // The card's server lists Apple, Google and its own SSO.
        guard try await stack().signInProviders() == ["apple", "google", "sso"] else {
            return try blocked("iphone-sign-in-providers", note: Self.needsProviders)
        }
        try await card("iphone-sign-in-providers") { card in
            try card.penny.wait(for: AccessibilityID.Auth.provider("apple"), timeout: 30)
            try await typeSignInEmail(card)
        }
    }

    @MainActor
    func test_whenTheServerListsAppleAndGoogle_IphoneCreateAccountProviders_ShouldBeCaptured() async throws {
        // The card's server lists Apple and Google only.
        guard try await stack().signInProviders() == ["apple", "google"] else {
            return try blocked("iphone-create-account-providers", note: Self.needsBrandsOnly)
        }
        try await card(
            "iphone-create-account-providers",
            note: "Screenshots leave out a secure field's bullets, so the typed password doesn't show"
        ) { card in
            try card.penny.tap(AccessibilityID.Auth.switchMode)
            try card.penny.wait(for: AccessibilityID.Auth.provider("google"), timeout: 30)
            try card.penny.type("Max Falicoff", into: AccessibilityID.Profile.signUpName)
            try card.penny.type("max@example.test", into: AccessibilityID.Auth.email)
            try card.penny.type("penny-card-pass", into: AccessibilityID.Auth.password)
            dragKeyboardAway(card)
        }
    }

    private static let needsBrandsOnly =
        "Needs a stack that lists Apple and Google only: PENNY_STACK_OIDC_PROVIDERS=brands scripts/ios.sh "
        + "ui-test cards (penny-env --oidc-providers --oidc-brands-only)"
    private static let needsProviders =
        "Needs a stack that lists Apple and Google: PENNY_STACK_OIDC_PROVIDERS=1 scripts/ios.sh ui-test cards "
        + "(penny-env --oidc-providers)"
    private static let needsSingleSignOnOnly =
        "The card shows the server's single sign-on alone; run without PENNY_STACK_OIDC_PROVIDERS"

    @MainActor
    func test_whenSignedOut_IphoneCreateAccount_ShouldBeCaptured() async throws {
        if try await stack().listsAppleAndGoogle() {
            return try blocked("iphone-create-account", note: Self.needsSingleSignOnOnly)
        }
        try await card(
            "iphone-create-account",
            note: "Screenshots leave out a secure field's bullets, so the typed password doesn't show"
        ) { card in
            try card.penny.tap(AccessibilityID.Auth.switchMode)
            try card.penny.wait(for: AccessibilityID.Auth.createAccount)
            // The card's filled form, with the strength meter for the typed password. Screenshots leave
            // out a secure field's bullets, so the password itself doesn't show.
            try card.penny.type("Max Falicoff", into: AccessibilityID.Profile.signUpName)
            try card.penny.type("max@example.test", into: AccessibilityID.Auth.email)
            try card.penny.type("penny-card-pass", into: AccessibilityID.Auth.password)
            card.penny.hideKeyboard()
        }
    }

    @MainActor
    func test_whenSignedOut_IphoneServerConnect_ShouldBeCaptured() async throws {
        // The test API is HTTPS with the run's certificate, which ui-test trusts on the simulator
        // (MAZ-265), so Server verified shows with the card's HTTPS lock.
        try await card("iphone-server-connect") { card in
            try card.penny.tap(AccessibilityID.Auth.changeServer)
            try card.penny.wait(for: AccessibilityID.Server.url)
            // The card shows the Server verified state: check the test server (no credential).
            try card.penny.tap(AccessibilityID.Server.check)
            try card.penny.wait(for: AccessibilityID.Server.verified, timeout: 30)
            card.penny.hideKeyboard()
        }
    }

    // MARK: iPhone failures

    @MainActor
    func test_whenTheNetworkFails_IphoneOffline_ShouldBeCaptured() async throws {
        try await card("iphone-offline", freshSeedPerAppearance: true) { card in
            // The card has two changes waiting (amber "Waiting to sync" rows, projected as of last sync).
            try await card.makeTwoPendingChanges(nil)
            try card.penny.openHome()
            try card.penny.waitAfterRefresh(for: AccessibilityID.Feedback.syncBanner, on: AccessibilityID.Screen.home)
        }
    }

    @MainActor
    func test_whenTheServerStopsAnswering_IphoneSyncFailed_ShouldBeCaptured() async throws {
        try await card("iphone-sync-failed", freshSeedPerAppearance: true) { card in
            // Two changes wait while the ledger answers 503: the amber "Couldn't sync" banner with
            // Retry over Home, and the rows waiting to sync.
            try await card.makeTwoPendingChanges(nil)
            try card.penny.openHome()
            try card.penny.waitAfterRefresh(for: AccessibilityID.Feedback.syncBanner, on: AccessibilityID.Screen.home)
        }
    }

    @MainActor
    func test_whenHouseholdsFailToLoad_IphoneSharedMissing_ShouldBeCaptured() async throws {
        try await card("iphone-shared-missing") { card in
            // The household projection answers 503: Home shows the amber "Shared expenses may be
            // missing" banner with Retry; the person's own entries still load.
            try await card.applyFault()
            try card.penny.openHome()
            try card.penny.waitAfterRefresh(
                for: AccessibilityID.Home.sharedNotice, on: AccessibilityID.Screen.home)
        }
    }

    @MainActor
    func test_whenASaveFails_IphoneSaveError_ShouldBeCaptured() async throws {
        try await card(
            "iphone-save-error", freshSeedPerAppearance: true,
            note:
                "Native saves on the device first: the 503 reaches the background sync, so the failure is the sync "
                + "banner (Couldn't sync, Retry) over Activity, not a Couldn't save banner in the closed form"
        ) { card in
            try await card.editCoffee(to: "6.40")
            try card.penny.openActivity()
            try card.penny.waitAfterRefresh(
                for: AccessibilityID.Feedback.syncBanner, on: AccessibilityID.Screen.activity)
        }
    }

    @MainActor
    func test_whenASaveSucceedsAfterRetry_IphoneSavedToast_ShouldBeCaptured() async throws {
        try await card(
            "iphone-saved-toast", freshSeedPerAppearance: true,
            note: "Native shows the saved toast when the entry is stored on the device, before the sync (and its retry)"
        ) { card in
            // The card adds an expense from Home ("Expense added" over Home).
            try await card.applyFault()
            try card.penny.openAddEntry()
            try card.penny.enterAmount("48.90")
            try card.penny.type("Groceries", into: AccessibilityID.EntryForm.title)
            try card.penny.tap(AccessibilityID.EntryForm.save)
            // The toast lasts 4 s: capture once the sheet has gone (see editCoffee).
            try await Task.sleep(for: .milliseconds(1200))
            card.captureNow()
            try card.penny.waitForAbsence(of: AccessibilityID.Screen.addEntry, timeout: 20)
        }
    }

    // MARK: iPhone drafted cards (MAZ-238, matched in MAZ-257)

    @MainActor
    func test_whenSeeded_IphoneCurrency_ShouldBeCaptured() async throws {
        try await card("iphone-currency") { card in
            // The seeded ledger has entries, so the currency is locked, as on the card.
            try card.penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
            try card.penny.wait(for: AccessibilityID.Settings.currency("CAD"))
        }
    }

    @MainActor
    func test_whenSeeded_IphoneNotificationsPrompt_ShouldBeCaptured() async throws {
        try await card("iphone-notifications-prompt") { card in
            // A fresh simulator hasn't decided on notifications, so Shared offers them once.
            try card.penny.openShared()
            try card.penny.waitAfterRefresh(
                for: AccessibilityID.Notifications.prompt, on: AccessibilityID.Screen.shared)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneScheduleForm_ShouldBeCaptured() async throws {
        try await card("iphone-schedule-form") { card in
            try card.penny.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
            try card.penny.tap(AccessibilityID.Organize.addSchedule, opening: AccessibilityID.Screen.scheduleForm)
            // The card's draft: a monthly Internet expense of $75.00, with the keyboard away. The
            // decimal pad has no Return, so the name goes last and its Return puts the keyboard away.
            try card.penny.type("75.00", into: "scheduleForm.amount")
            try card.penny.type("Internet\n", into: "scheduleForm.title")
            guard card.penny.app.keyboards.firstMatch.waitForNonExistence(timeout: 3) else {
                throw UIExpectationFailed(description: "Return did not put the keyboard away")
            }
        }
    }

    @MainActor
    func test_whenSignedOut_IphoneDemo_ShouldBeCaptured() async throws {
        try await card("iphone-demo") { card in
            // Sign-in's sample-data link opens Home in the demo, under its banner.
            try card.penny.tap(AccessibilityID.Auth.tryDemo)
            try card.penny.wait(for: "banner.demo", timeout: 30)
            try card.penny.wait(for: AccessibilityID.Home.hero)
        }
    }

    // MARK: Crash and performance reports (MAZ-129)

    private static let needsTelemetry =
        "Needs a stack that offers crash reports: PENNY_STACK_TELEMETRY=1 scripts/ios.sh ui-test cards "
        + "(penny-env --telemetry)"

    @MainActor
    func test_whenTheServerOffersReports_IphoneMonitoringPrompt_ShouldBeCaptured() async throws {
        guard try await stack().takesNativeTelemetry() else {
            return try blocked("iphone-monitoring-prompt", note: Self.needsTelemetry)
        }
        try await card("iphone-monitoring-prompt") { card in
            // A fresh install hasn't answered, so Home asks once after sign-in.
            try card.penny.wait(for: AccessibilityID.Monitoring.promptScreen, timeout: 30)
            try card.penny.wait(for: AccessibilityID.Monitoring.share)
        }
    }

    @MainActor
    func test_whenTheServerOffersReports_IphonePrivacy_ShouldBeCaptured() async throws {
        guard try await stack().takesNativeTelemetry() else {
            return try blocked("iphone-privacy", note: Self.needsTelemetry)
        }
        // The card's choices: crash reports on, performance data off (answered, so no prompt).
        let choices = Data(#"{"crashes":true,"performance":false,"decided":true}"#.utf8)
        try await card("iphone-privacy", defaults: ["penny.telemetry": choices]) { card in
            try card.penny.openSettingsPage("privacy", screen: AccessibilityID.Monitoring.privacyScreen)
            try card.penny.wait(for: AccessibilityID.Monitoring.policy)
        }
    }

    // MARK: Emailed receipts (MAZ-184): recorded as blocked until the seeds have an inbox

    @MainActor
    func test_whenSeeded_IphoneReceiptInbox_ShouldBeCaptured() async throws {
        try await card("iphone-receipt-inbox") { card in try card.openReceiptInbox() }
    }

    @MainActor
    func test_whenSeeded_IphoneReceiptInboxItem_ShouldBeCaptured() async throws {
        try await card("iphone-receipt-inbox-item") { card in try card.openInboxItem() }
    }

    @MainActor
    func test_whenSeeded_IphoneReceiptAttachFile_ShouldBeCaptured() async throws {
        try await card("iphone-receipt-attach-file") { card in try card.openAttachSheet() }
    }

    @MainActor
    func test_whenSeeded_IphoneReceiptAttachEntry_ShouldBeCaptured() async throws {
        try await card("iphone-receipt-attach-entry") { card in try card.openAttachEntries() }
    }

    @MainActor
    func test_whenSeeded_IphoneReceiptAttachConfirm_ShouldBeCaptured() async throws {
        try await card("iphone-receipt-attach-confirm") { card in try card.openAttachConfirm() }
    }

    @MainActor
    func test_whenSeeded_IphoneReceiptAttachedToast_ShouldBeCaptured() async throws {
        try await card("iphone-receipt-attached-toast", freshSeedPerAppearance: true) { card in
            try card.attachFromInbox()
        }
    }

    @MainActor
    func test_whenSeeded_IphoneReceiptEmailSettings_ShouldBeCaptured() async throws {
        try await card("iphone-receipt-email-settings") { card in try card.openReceiptEmail() }
    }

    // MARK: iPad

    @MainActor
    func test_whenSeeded_IpadHome_ShouldBeCaptured() async throws {
        try await card("ipad-home") { card in try card.penny.wait(for: AccessibilityID.Home.hero) }
    }

    @MainActor
    func test_whenSeeded_IpadHomePortrait_ShouldBeCaptured() async throws {
        try await card("ipad-home-portrait", portrait: true) { card in
            try card.penny.wait(for: AccessibilityID.Home.hero)
        }
    }

    @MainActor
    func test_whenSeeded_IpadActivity_ShouldBeCaptured() async throws {
        try await card("ipad-activity") { card in
            try await card.attachReceipt(to: "p-party")
            try card.penny.openSeptemberEntry("p-party", withReceipt: true)
        }
    }

    @MainActor
    func test_whenSeeded_IpadAddEntry_ShouldBeCaptured() async throws {
        try await card("ipad-add-entry", freshSeedPerAppearance: true) { card in try card.penny.draftEntry() }
    }

    @MainActor
    func test_whenSeeded_IpadShared_ShouldBeCaptured() async throws {
        try await card("ipad-shared") { card in try card.penny.openHousehold(card.seeded().household("maison")) }
    }

    @MainActor
    func test_whenSeeded_IpadTrip_ShouldBeCaptured() async throws {
        try await card("ipad-trip") { card in try card.penny.openLisbon(card.seeded()) }
    }

    @MainActor
    func test_whenSeeded_IpadSettings_ShouldBeCaptured() async throws {
        try await card("ipad-settings", freshSeedPerAppearance: true, followsSystem: true, standInFaceID: true) {
            card in
            try card.penny.turnOnAppLock()
            try card.penny.openSettings()
            // The page beside the list (MAZ-182) is the card's Appearance, not the lock just set.
            try card.penny.tap(AccessibilityID.Settings.row("appearance"), opening: AccessibilityID.Screen.appearance)
        }
    }

    @MainActor
    func test_whenSeeded_IpadProfile_ShouldBeCaptured() async throws {
        try await card("ipad-profile") { card in
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Settings.account, opening: AccessibilityID.Profile.screen)
            try card.penny.wait(for: AccessibilityID.Profile.changePassword)
            // The Sign-in row reads as one element: its email, how it signs in and Verified.
            guard
                try card.penny.wait(for: AccessibilityID.Profile.signIn).waitForLabel(
                    containing: "Verified", timeout: 20)
            else { throw UIExpectationFailed(description: "The Sign-in row has no Verified mark") }
            try card.penny.wait(for: AccessibilityID.AccountData.deleteRow)
        }
    }

    // MARK: iPad emailed receipts (MAZ-184): recorded as blocked until the seeds have an inbox

    @MainActor
    func test_whenSeeded_IpadReceiptInbox_ShouldBeCaptured() async throws {
        try await card("ipad-receipt-inbox") { card in try card.openReceiptInbox() }
    }

    @MainActor
    func test_whenSeeded_IpadReceiptInboxItem_ShouldBeCaptured() async throws {
        try await card("ipad-receipt-inbox-item") { card in try card.openInboxItem() }
    }

    @MainActor
    func test_whenSeeded_IpadReceiptAttachFile_ShouldBeCaptured() async throws {
        try await card("ipad-receipt-attach-file") { card in try card.openAttachSheet() }
    }

    @MainActor
    func test_whenSeeded_IpadReceiptAttachEntry_ShouldBeCaptured() async throws {
        try await card("ipad-receipt-attach-entry") { card in try card.openAttachEntries() }
    }

    @MainActor
    func test_whenSeeded_IpadReceiptAttachConfirm_ShouldBeCaptured() async throws {
        try await card("ipad-receipt-attach-confirm") { card in try card.openAttachConfirm() }
    }

    @MainActor
    func test_whenSeeded_IpadReceiptAttachedToast_ShouldBeCaptured() async throws {
        try await card("ipad-receipt-attached-toast", freshSeedPerAppearance: true) { card in
            try card.attachFromInbox()
        }
    }

    @MainActor
    func test_whenSeeded_IpadReceiptEmailSettings_ShouldBeCaptured() async throws {
        try await card("ipad-receipt-email-settings") { card in try card.openReceiptEmail() }
    }
}

// MARK: Card steps

@MainActor
extension Penny {
    /// The new-entry draft the entry cards show: $74.40, "Dinner with friends".
    func draftEntry(kind: String = "Expense", amount: String = "74.40", title: String = "Dinner with friends") throws {
        try openAddEntry()
        if kind != "Expense" { try selectSegment(kind, in: AccessibilityID.EntryForm.kind) }
        // The title first: tapping the amount afterwards puts the keyboard away (iPhone's keypad).
        // On a freshly booted simulator the first tap can land before the field takes focus.
        let titleField = try wait(for: AccessibilityID.EntryForm.title)
        for _ in 0..<3 where !app.keyboards.firstMatch.exists {
            titleField.tap()
            _ = app.keyboards.firstMatch.waitForExistence(timeout: 3)
        }
        titleField.typeText(title)
        let amountField = try wait(for: AccessibilityID.EntryForm.amount)
        if amountField.elementType != .textField {
            amountField.tap()
            _ = app.keyboards.firstMatch.waitForNonExistence(timeout: 5)
        }
        try enterAmount(amount)
        hideKeyboard()
    }

    /// Taps a row of the entry form and waits for `screen`. On iPhone the in-sheet keypad covers
    /// the lower rows (a tap there would type a digit), so the form is scrolled up above it first.
    func tapFormRow(_ id: String, opening screen: String) throws {
        let row = try wait(for: id)
        let keypad = element(AccessibilityID.EntryForm.keypad("1"))
        for _ in 0..<4 where keypad.exists && row.frame.maxY > keypad.frame.minY - 8 {
            // Drag from just above the keypad (on the form, not a row's control) towards the top.
            let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            let start = origin.withOffset(CGVector(dx: app.frame.width - 12, dy: keypad.frame.minY - 30))
            let end = origin.withOffset(CGVector(dx: app.frame.width - 12, dy: keypad.frame.minY * 0.45))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        try tap(id, opening: screen)
    }

    /// Scrolls the screen up, slowly and from its right edge, until `id` ends above `limit` (a
    /// y in the app's frame): the floating tab bar, or the entry form's keypad.
    /// `partly` settles for the element's first 44 points, for a last row the screen can't
    /// scroll clear of the bar.
    func reveal(_ id: String, above limit: CGFloat, partly: Bool = false) throws {
        let target = try wait(for: id)
        func bottom() -> CGFloat { partly ? target.frame.minY + min(44, target.frame.height) : target.frame.maxY }
        let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        let x = app.frame.width - 12
        for _ in 0..<5 where bottom() > limit - 8 {
            let start = limit - 30
            let distance = min(bottom() - limit + 40, start * 0.5)
            origin.withOffset(CGVector(dx: x, dy: start)).press(
                forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: x, dy: start - distance)),
                withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        guard bottom() <= limit else {
            throw UIExpectationFailed(description: "\(id) stayed below y \(Int(limit))")
        }
    }

    /// Chooses the entry form's account (`accountPicker.<id>`).
    func chooseAccount(_ id: String) throws {
        try tapFormRow(AccessibilityID.EntryForm.account, opening: AccessibilityID.Screen.accountPicker)
        try tap("accountPicker.\(id)")
        try waitForAbsence(of: AccessibilityID.Screen.accountPicker)
    }

    /// Splits the entry form's amount equally between `people`, including you, and applies the
    /// split (or leaves the Split sheet open, as the `iphone-split` card shows it).
    func splitEqually(people: Int, apply: Bool = true) throws {
        try tapFormRow(AccessibilityID.Cards.entrySplit, opening: AccessibilityID.Screen.split)
        try selectSegment("Equally", in: AccessibilityID.Cards.splitMode)
        // The counter starts at 2; its buttons carry the count as their value ("3 people").
        let increment = app.buttons["split.people.increment"]
        guard increment.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "The split has no people stepper")
        }
        for _ in 2..<people { increment.tap() }
        let reached = NSPredicate(format: "value == %@", "\(people) people")
        guard
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: reached, object: increment)], timeout: 5)
                == .completed
        else { throw UIExpectationFailed(description: "The split did not reach \(people) people") }
        guard apply else { return }
        try tap("split.done")
        try waitForAbsence(of: AccessibilityID.Screen.split)
    }

    /// Chooses a day of `month` (2026) in the entry form's date picker.
    func chooseDate(month: String, day: Int) throws {
        try tapFormRow(AccessibilityID.EntryForm.date, opening: AccessibilityID.Screen.datePicker)
        let calendar = try wait(for: "datePicker.calendar")
        let label = NSPredicate(
            format: "label ENDSWITH %@ OR label CONTAINS %@ OR label CONTAINS %@", "\(month) \(day)",
            "\(month) \(day),", " \(day) \(month)")
        let button = calendar.buttons.matching(label).firstMatch
        guard button.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "The date picker has no \(month) \(day)")
        }
        button.tap()
        if element(AccessibilityID.Screen.datePicker).exists, element("datePicker.done").exists {
            try tap("datePicker.done")
        }
        try waitForAbsence(of: AccessibilityID.Screen.datePicker)
    }

    /// Activity in September 2026, with a personal entry opened (beside the list on iPad).
    /// `withReceipt` refreshes until the entry shows the receipt another device attached.
    func openSeptemberEntry(_ id: String, withReceipt: Bool = false) throws {
        try openActivity()
        try selectActivityMonth("September 2026")
        try openEntry(id)
        guard withReceipt else { return }
        // The detail is a lazy list: its receipt row exists once scrolled to (on iPad, the
        // detail column on the right).
        let receipt = element(AccessibilityID.Receipt.detailRow)
        let x = Device.isPad ? 0.8 : 0.9
        func scrollDetail(down: Bool) {
            let (from, to) = down ? (0.75, 0.3) : (0.3, 0.75)
            app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: from)).press(
                forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: to)))
        }
        for _ in 0..<4 {
            scrollDetail(down: true)
            if receipt.waitForExistence(timeout: 4) { break }
            // Not synced yet: refresh the list and open the entry again. On iPad the first list
            // is the sidebar, so pull the Activity column itself.
            if Device.isPad {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.42, dy: 0.25)).press(
                    forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.42, dy: 0.8)))
            } else {
                app.navigationBars.buttons.firstMatch.tap()
                pullToRefresh()
            }
            try openEntry(id)
        }
        try wait(for: AccessibilityID.Receipt.detailRow)
        // The iPad card shows the detail from its top.
        if Device.isPad { for _ in 0..<2 { scrollDetail(down: false) } }
    }

    /// Turns a toggle on (its switch where the row wraps one) and waits for it.
    func turnOn(_ id: String) throws {
        let toggle = try wait(for: id)
        guard toggle.value as? String != "1" else { return }
        let control = toggle.switches.firstMatch.exists ? toggle.switches.firstMatch : toggle
        control.tap()
        let on = NSPredicate(format: "value == '1'")
        guard
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: on, object: toggle)], timeout: Penny.timeout)
                == .completed
        else { throw UIExpectationFailed(description: "\(id) did not turn on") }
    }

    /// Settings › Face ID lock on (needs the launch's `standInFaceID`), then back to the shell
    /// unless `closing` is false.
    func turnOnAppLock(closing: Bool = true) throws {
        try openSettingsPage("appLock", screen: AccessibilityID.Screen.appLock)
        try turnOn(AccessibilityID.Settings.appLockToggle)
        try waitForSelection(AccessibilityID.Settings.appLockDelay("immediately"))
        if closing { try closeSettings() }
    }

    /// As bea: Maison › Internet › record alex's share.
    func openRecordShare(_ seed: SeedContext) throws {
        try openHousehold(seed.household("maison"))
        let internet = try seed.expense("internet")
        try waitAfterRefresh(for: Households.expense(internet), on: AccessibilityID.Screen.household)
        try tap(Households.expense(internet), opening: AccessibilityID.Screen.householdExpense)
        try tap(Households.markPaid(seed.userIDs["alex"] ?? ""), opening: Households.Screen.recordShare)
    }

    /// The Lisbon trip's row on the Trips tab: featured (the next trip) or listed.
    func lisbonRow(_ seed: SeedContext) throws -> XCUIElement {
        let listed = element(AccessibilityID.Row.trip(try seed.household("lisbon")))
        let featured = element(Trips.featured)
        let deadline = Date().addingTimeInterval(30)
        while !listed.exists && !featured.exists {
            guard Date() < deadline else { throw UIExpectationFailed(description: "Lisbon trip is not listed") }
            pullHouseholdToRefresh(AccessibilityID.Screen.trips)
            _ = listed.waitForExistence(timeout: 3)
        }
        return listed.exists ? listed : featured
    }

    func openLisbon(_ seed: SeedContext) throws {
        try openTrips()
        let row = try lisbonRow(seed)
        for _ in 0..<3 {
            row.tap()
            if element(Trips.Screen.sharedTrip).waitForExistence(timeout: 8) { return }
            dismissSavePassword(timeout: 2)
        }
        try wait(for: Trips.Screen.sharedTrip)
    }
}

@MainActor
extension CardContext {
    /// Attaches the seeded receipt photo to a personal entry, from "another device" as the card's alias.
    func attachReceipt(to id: String) async throws {
        let token = try seeded().user(state.alias ?? "alex").token
        let photo = try ReceiptFixtures.load()
        let receipt = try await stack.uploadReceipt(
            token: token, name: "receipt.png", mime: "image/png", data: try photo.data(ReceiptFixtures.photo))
        try await stack.editTransaction(token: token, id: id, ["receipt": receipt])
    }

    /// Two changes the server doesn't take: Coffee edited to $6.40 and a new $48.90 Groceries.
    /// `rule` drops the writes (nil: the card's own fault).
    func makeTwoPendingChanges(_ rule: FaultRule?) async throws {
        if let rule { try await stack.setFaults([rule]) } else { try await applyFault() }
        try penny.openActivity()
        try penny.openEntry("p-coffee-2")
        try penny.editOpenEntry()
        try penny.replaceAmount("6.40")
        try penny.saveEntryForm()
        try penny.addEntry(amount: "48.90", title: "Groceries")
    }

    /// Edits Coffee (p-coffee-2) to `amount` with the card's fault in place for the sync.
    func editCoffee(to amount: String, captureToast: Bool = false) async throws {
        try penny.openActivity()
        try penny.openEntry("p-coffee-2")
        try penny.editOpenEntry()
        try penny.replaceAmount(amount)
        try await applyFault()
        try penny.tap(AccessibilityID.EntryForm.save)
        // The toast lasts 4 s; an element query can outlast it, so capture right after the tap.
        // `toast.saved` was not found by queries in this state, so wait out the sheet's dismissal
        // (a fixed delay is the point here) and capture while the toast shows.
        if captureToast {
            try await Task.sleep(for: .milliseconds(1200))
            captureNow()
        }
        try penny.waitForAbsence(of: AccessibilityID.Screen.editEntry, timeout: 20)
    }
}

/// The emailed-receipt cards' steps (MAZ-184), shared by iPhone and iPad. Their states name the
/// seeded inbox items (Acme Store, Mill St. Coffee), whose ids the server assigns, so rows are
/// found by their identifier prefix and label.
extension CardContext {
    private typealias Inbox = AccessibilityID.ReceiptInbox

    @MainActor
    func openReceiptInbox() throws {
        try penny.openSettings()
        try penny.tap(Inbox.settingsRow)
        try penny.wait(for: Inbox.inboxScreen, timeout: 20)
    }

    @MainActor
    func openReceiptEmail() throws {
        try penny.openSettings()
        try penny.tap(AccessibilityID.Settings.row("receiptEmail"))
        try penny.wait(for: Inbox.emailScreen, timeout: 20)
        try penny.wait(for: Inbox.address)
    }

    /// Opens the inbox email whose row's label contains `sender`.
    @MainActor
    func openInboxItem(from sender: String = "Acme Store") throws {
        try openReceiptInbox()
        let row = app.buttons
            .matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS %@", Inbox.item(""), sender))
            .firstMatch
        guard row.waitForExistence(timeout: 20) else {
            throw UIExpectationFailed(description: "the inbox has no email from \(sender)")
        }
        row.tap()
        try penny.wait(for: Inbox.itemScreen, timeout: 20)
    }

    @MainActor
    func openAttachSheet(from sender: String = "Acme Store") throws {
        try openInboxItem(from: sender)
        try penny.tap(Inbox.attach)
        try penny.wait(for: Inbox.attachScreen, timeout: 20)
    }

    @MainActor
    func openAttachEntries(from sender: String = "Acme Store") throws {
        try openAttachSheet(from: sender)
        try penny.tap(Inbox.attachNext)
        try penny.wait(for: Inbox.suggested, timeout: 20)
    }

    /// The card's confirm step: Acme Store's file on the shared expense Printer ink.
    @MainActor
    func openAttachConfirm() throws {
        try openAttachEntries()
        try tapTarget(prefix: "shared-", label: "Printer ink")
        try penny.wait(for: Inbox.confirm, timeout: 20)
    }

    /// Attaches Mill St. Coffee's receipt to Coffee at Mill St.: the inbox with View entry and Undo.
    @MainActor
    func attachFromInbox() throws {
        try openAttachEntries(from: "Mill St. Coffee")
        try tapTarget(prefix: "entry-", label: "Coffee")
        try penny.tap(Inbox.confirm)
        try penny.wait(for: Inbox.viewEntry, timeout: 20)
    }

    @MainActor
    private func tapTarget(prefix: String, label: String) throws {
        let target = app.buttons
            .matching(
                NSPredicate(
                    format: "identifier BEGINSWITH %@ AND label CONTAINS %@", Inbox.target(prefix), label)
            )
            .firstMatch
        guard target.waitForExistence(timeout: 20) else {
            throw UIExpectationFailed(description: "the attach sheet offers no \(label)")
        }
        target.tap()
    }
}
