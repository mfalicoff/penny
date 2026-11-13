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
                + "captured in WidgetKit previews and the device checklist (docs/ios-qa.md)")
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
    func test_whenSeeded_IphoneMoneyFlow_ShouldBeCaptured() async throws {
        try await card("iphone-money-flow") { card in
            try card.penny.selectMonth("September 2026")
            try card.penny.tap(AccessibilityID.Home.exploreMoneyFlow)
            try card.penny.wait(for: AccessibilityID.Screen.moneyFlow)
            try card.penny.wait(for: AccessibilityID.Overview.flowChart)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneInsights_ShouldBeCaptured() async throws {
        try await card("iphone-insights") { card in
            try card.penny.tap(AccessibilityID.Home.exploreInsights)
            try card.penny.wait(for: AccessibilityID.Screen.insights)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneCalendar_ShouldBeCaptured() async throws {
        try await card("iphone-calendar") { card in
            try card.penny.tap(AccessibilityID.Home.exploreCalendar)
            try card.penny.wait(for: AccessibilityID.Screen.calendar)
            try card.penny.wait(for: AccessibilityID.Overview.calendarGrid)
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
            // Return submits the search and puts the keyboard away, as on the card.
            try card.penny.search((card.state.search ?? "zzzz") + "\n")
            try card.penny.wait(for: AccessibilityID.Activity.searchEmpty, timeout: 30)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAddExpense_ShouldBeCaptured() async throws {
        try await card("iphone-add-expense", freshSeedPerAppearance: true) { card in try card.penny.draftEntry() }
    }

    @MainActor
    func test_whenSeeded_IphoneAddIncome_ShouldBeCaptured() async throws {
        try await card("iphone-add-income", freshSeedPerAppearance: true) { card in
            try card.penny.draftEntry(kind: "Income", amount: "3200.00", title: "Payday")
        }
    }

    @MainActor
    func test_whenSeeded_IphoneEntryExtras_ShouldBeCaptured() async throws {
        try await card("iphone-entry-extras", freshSeedPerAppearance: true) { card in
            try card.penny.draftEntry()
            try card.penny.tapFormRow(AccessibilityID.Receipt.moreDetails, opening: AccessibilityID.Screen.entryExtras)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneSplit_ShouldBeCaptured() async throws {
        try await card("iphone-split", freshSeedPerAppearance: true) { card in
            try card.penny.draftEntry()
            try card.penny.tapFormRow(AccessibilityID.Cards.entrySplit, opening: AccessibilityID.Screen.split)
            try card.penny.selectSegment("Percent", in: AccessibilityID.Cards.splitMode)
            try card.penny.type("50", into: AccessibilityID.Cards.splitInput)
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
        try await card("iphone-entry-detail") { card in try card.penny.openSeptemberEntry("p-party") }
    }

    @MainActor
    func test_whenSeeded_IphoneReceipt_ShouldBeRecorded() async throws {
        try await card("iphone-receipt") { _ in }
    }

    @MainActor
    func test_whenSeeded_IphoneDeleteConfirm_ShouldBeCaptured() async throws {
        try await card("iphone-delete-confirm") { card in
            try card.penny.openActivity()
            try card.penny.openEntry("p-coffee-2")
            try card.penny.tap(AccessibilityID.Journeys.detailDelete)
            try card.penny.wait(for: AccessibilityID.Activity.deleteConfirm)
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
        }
    }

    @MainActor
    func test_whenSeeded_IphoneHistory_ShouldBeCaptured() async throws {
        try await card("iphone-history") { card in
            try card.penny.openHousehold(card.seeded().household("maison"))
            try card.penny.tap(Households.history, opening: Households.Screen.history)
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
        }
    }

    // MARK: iPhone settings

    @MainActor
    func test_whenSeeded_IphoneSettings_ShouldBeCaptured() async throws {
        try await card("iphone-settings") { card in try card.penny.openSettings() }
    }

    @MainActor
    func test_whenSeeded_IphoneRecurring_ShouldBeCaptured() async throws {
        try await card("iphone-recurring") { card in
            try card.penny.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
            try card.penny.wait(for: AccessibilityID.Organize.schedule("r-gym"))
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
            try card.penny.tap(AccessibilityID.Organize.addAccount, opening: AccessibilityID.Screen.accountForm)
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
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAppearance_ShouldBeCaptured() async throws {
        try await card("iphone-appearance") { card in
            try card.penny.openSettingsPage("appearance", screen: AccessibilityID.Screen.appearance)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneAppLock_ShouldBeCaptured() async throws {
        try await card(
            "iphone-app-lock",
            note: "The simulator has no enrolled Face ID, so the page shows the lock as unavailable and off"
        ) { card in
            try card.penny.openSettingsPage("appLock", screen: AccessibilityID.Screen.appLock)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneLock_ShouldBeRecorded() async throws {
        try blocked(
            "iphone-lock",
            note:
                "The lock cover needs the Face ID lock turned on, which needs enrolled, matching Face ID; XCUITest "
                + "cannot enroll or match biometrics (device checklist, docs/ios-qa.md)")
    }

    @MainActor
    func test_whenSeeded_IphoneSignOut_ShouldBeCaptured() async throws {
        try await card("iphone-sign-out") { card in
            try card.penny.openSettings()
            try card.penny.tap(AccessibilityID.Auth.signOut)
            _ = try card.penny.dialogButton("Sign out")
        }
    }

    // MARK: iPhone signed out

    @MainActor
    func test_whenSignedOut_IphoneSignIn_ShouldBeCaptured() async throws {
        try await card("iphone-sign-in") { card in
            let solo = try card.seeded().user(card.state.alias ?? "solo")
            try card.penny.type(solo.email, into: AccessibilityID.Auth.email)
            card.penny.hideKeyboard()
        }
    }

    @MainActor
    func test_whenSignedOut_IphoneCreateAccount_ShouldBeCaptured() async throws {
        try await card("iphone-create-account") { card in
            try card.penny.tap(AccessibilityID.Auth.switchMode)
            try card.penny.wait(for: AccessibilityID.Auth.createAccount)
        }
    }

    @MainActor
    func test_whenSignedOut_IphoneServerConnect_ShouldBeCaptured() async throws {
        try await card("iphone-server-connect") { card in
            try card.penny.tap(AccessibilityID.Auth.changeServer)
            try card.penny.wait(for: AccessibilityID.Server.url)
        }
    }

    // MARK: iPhone failures

    @MainActor
    func test_whenTheNetworkFails_IphoneOffline_ShouldBeCaptured() async throws {
        try await card("iphone-offline") { card in
            try await card.applyFault()
            try card.penny.waitAfterRefresh(for: AccessibilityID.Feedback.syncBanner, on: AccessibilityID.Screen.home)
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
            note: "Native shows the saved toast when the edit is stored on the device, before the sync (and its retry)"
        ) { card in
            try await card.editCoffee(to: "6.40", captureToast: true)
        }
    }

    // MARK: iPad

    @MainActor
    func test_whenSeeded_IpadHome_ShouldBeCaptured() async throws {
        try await card("ipad-home") { card in try card.penny.wait(for: AccessibilityID.Home.hero) }
    }

    @MainActor
    func test_whenSeeded_IpadActivity_ShouldBeCaptured() async throws {
        try await card("ipad-activity") { card in try card.penny.openSeptemberEntry("p-party") }
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
        try await card("ipad-settings") { card in try card.penny.openSettings() }
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
        try type(title, into: AccessibilityID.EntryForm.title)
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

    /// Activity in September 2026, with a personal entry opened (beside the list on iPad).
    func openSeptemberEntry(_ id: String) throws {
        try openActivity()
        try selectMonth("September 2026")
        try openEntry(id)
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
