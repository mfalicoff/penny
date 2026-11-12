import Foundation
import PennyAccessibility
import XCTest

private typealias IDs = AccessibilityID.Trips
private typealias Shared = AccessibilityID.Households

/// Personal and shared trip journeys on the real API (MAZ-76, Full plan): the app is the
/// organizer, the stack's HTTP API is the other person's device. Nothing is mocked.
final class TripJourneyTests: PennyUITestCase {
    /// A personal trip with an expense from before sharing → Share trip → the expense is never
    /// sent and shows under Only you → a shared expense before anyone joins → Bea joins → a
    /// second shared expense splits between both, the first keeps its participants → the trip
    /// total counts shared expenses once and your spending adds the private one once →
    /// Balances settle the month.
    @MainActor
    func test_whenAPersonalTripIsShared_Journey_ShouldKeepEarlierExpensesPrivateAndSplitLaterOnes() async throws {
        let stack = try await stack()
        let alex = try await makeAccount("trip-alex")
        let bea = try await makeAccount("trip-bea")
        let tripID = "trip-\(Device.name.lowercased().filter(\.isLetter))"
        try await stack.addTrip(
            token: alex.token, id: tripID, name: "Lisbon", start: "2026-10-10", end: "2026-10-20",
            expenseID: "airport-train", expenseTitle: "Airport train", cents: 2400, expenseDate: "2026-09-20")
        let penny = try await launch()
        try penny.signIn(email: alex.email, password: alex.password)
        penny.dismissSavePassword(timeout: 10)

        // The personal trip: its expense dated before the trip still belongs to it.
        try penny.openURL("penny://trips/\(tripID)")
        try penny.wait(for: AccessibilityID.Screen.trip, timeout: 30)
        try penny.wait(for: AccessibilityID.Row.entry("airport-train"), timeout: 30)
        try penny.waitForLabel(try penny.wait(for: IDs.outside), containing: "1 outside the trip dates")
        screenshot("personal-trip")

        // Share it: a shared trip with the same name and dates, the expense kept private.
        try penny.tap(IDs.share, opening: IDs.Screen.share)
        screenshot("share-personal-trip")
        try penny.tap(IDs.shareConfirm)
        try penny.waitForAbsence(of: IDs.Screen.share, timeout: 20)
        try penny.wait(for: IDs.Screen.sharedTrip, timeout: 20)
        let listed = try await stack.households(token: alex.token)
        let trip = try XCTUnwrap(listed.first { ($0["trip"] as? [String: Any]) != nil })
        let household = try XCTUnwrap(trip["id"] as? String)
        XCTAssertEqual((trip["trip"] as? [String: Any])?["startDate"] as? String, "2026-10-10")
        let none = try await stack.expenses(token: alex.token, household: household)
        XCTAssertTrue(none.isEmpty, "the personal trip's expense is never sent to the shared trip")
        try await stack.waitForLedger(token: alex.token) { ledger in
            let trips = ledger["trips"] as? [[String: Any]] ?? []
            return trips.contains { $0["id"] as? String == tripID && $0["sharedHouseholdId"] as? String == household }
        }
        try penny.scroll(to: IDs.onlyYou, in: IDs.Screen.sharedTrip)
        try penny.scroll(to: AccessibilityID.Row.entry("airport-train"), in: IDs.Screen.sharedTrip)
        screenshot("shared-trip-only-you")
        penny.scrollToTop(of: IDs.Screen.sharedTrip)

        // A shared expense before anyone else joins: Alex alone is in it.
        try addSharedExpense(penny, amount: "50", title: "Apartment deposit")
        try await stack.waitForExpenses(token: alex.token, household: household) { $0.count == 1 }

        // Bea joins after it, then a second shared expense splits between both.
        let code = try await stack.invite(token: alex.token, household: household)
        try await stack.join(token: bea.token, code: code)
        try penny.selectSegment("People", in: Shared.section)
        try penny.waitAfterRefresh(for: Shared.member(bea.userID), on: IDs.Screen.sharedTrip)
        screenshot("trip-people")
        try penny.selectSegment("Expenses", in: Shared.section)
        try addSharedExpense(penny, amount: "120", title: "Dinner")
        let expenses = try await stack.waitForExpenses(token: bea.token, household: household) { $0.count == 2 }
        func splits(_ title: String) -> [Int] {
            let expense = expenses.first { $0["title"] as? String == title }
            return (expense?["splits"] as? [[String: Any]] ?? []).compactMap { $0["amountCents"] as? Int }
        }
        XCTAssertEqual(splits("Apartment deposit"), [5000], "joining later never changes earlier participants")
        XCTAssertEqual(splits("Dinner").sorted(), [6000, 6000])
        XCTAssertFalse(
            expenses.contains { $0["title"] as? String == "Airport train" }, "Bea never sees the private expense")

        // Totals count each expense once: the trip's shared spending, your shares plus your own.
        try penny.waitForLabel(try penny.wait(for: IDs.total), containing: "170.00", on: IDs.Screen.sharedTrip)
        try penny.waitForLabel(try penny.wait(for: IDs.yourSpending), containing: "134.00", on: IDs.Screen.sharedTrip)
        screenshot("shared-trip-totals")

        // Balances settle by month.
        try penny.selectSegment("Balances", in: Shared.section)
        try penny.wait(for: Shared.balanceRow(bea.userID), timeout: 20)
        screenshot("trip-balances")
    }

    /// New trip creates a personal trip, Trip expense opens Add entry on it, and Delete is refused
    /// while the expense is on the trip and allowed once another device moved it to No trip.
    @MainActor
    func test_whenATripHasAnExpense_Delete_ShouldBeRefusedUntilTheExpenseIsMoved() async throws {
        let stack = try await stack()
        let alex = try await makeAccount("trip-crud")
        let penny = try await launch()
        try penny.signIn(email: alex.email, password: alex.password)
        penny.dismissSavePassword(timeout: 10)
        try penny.openURL("penny://trips")
        try penny.wait(for: AccessibilityID.Screen.trips, timeout: 30)

        try penny.tap(IDs.new, opening: IDs.Screen.form)
        screenshot("trip-form")
        try penny.type("Cottage", into: IDs.formName)
        try penny.tap(IDs.formSave)
        try penny.waitForAbsence(of: IDs.Screen.form, timeout: 20)
        try penny.wait(for: AccessibilityID.Screen.trip, timeout: 20)
        let ledger = try await stack.waitForLedger(token: alex.token) { ledger in
            (ledger["trips"] as? [[String: Any]] ?? []).contains { $0["name"] as? String == "Cottage" }
        }
        let tripID = try XCTUnwrap(
            (ledger["trips"] as? [[String: Any]])?.first { $0["name"] as? String == "Cottage" }?["id"] as? String)

        // Trip expense: Add entry opens on the trip.
        try penny.tap(IDs.addExpense, opening: AccessibilityID.Screen.addEntry)
        try penny.enterAmount("42")
        try penny.type("Firewood", into: AccessibilityID.EntryForm.title)
        try penny.tap(AccessibilityID.EntryForm.save)
        try penny.waitForAbsence(of: AccessibilityID.Screen.addEntry, timeout: 20)
        let saved = try await stack.waitForLedger(token: alex.token) { ledger in
            (ledger["transactions"] as? [[String: Any]] ?? []).contains { $0["tripId"] as? String == tripID }
        }
        let entryID = try XCTUnwrap(
            (saved["transactions"] as? [[String: Any]])?.first { $0["tripId"] as? String == tripID }?["id"] as? String)
        try penny.wait(for: AccessibilityID.Row.entry(entryID), timeout: 20)

        // Delete is refused while the expense is on the trip, and says why.
        try penny.tap(IDs.edit, opening: IDs.Screen.form)
        XCTAssertFalse(try penny.wait(for: IDs.formDelete).isEnabled)
        try penny.wait(for: IDs.formDeleteNote)
        try penny.tap(IDs.formClose)
        try penny.waitForAbsence(of: IDs.Screen.form)

        // Move it to No trip (Edit entry › Trip), then the trip can go.
        try await stack.moveToNoTrip(token: alex.token, entryID: entryID)
        try await stack.waitForLedger(token: alex.token) { ledger in
            (ledger["transactions"] as? [[String: Any]] ?? []).allSatisfy { $0["tripId"] == nil }
        }
        try penny.waitForAbsenceAfterRefresh(of: AccessibilityID.Row.entry(entryID), on: AccessibilityID.Screen.trip)
        try penny.tap(IDs.edit, opening: IDs.Screen.form)
        try penny.tap(IDs.formDelete)
        try penny.dialogButton("Delete trip").tap()
        try penny.waitForAbsence(of: IDs.Screen.form, timeout: 20)
        try penny.wait(for: AccessibilityID.Screen.trips, timeout: 20)
        try await stack.waitForLedger(token: alex.token) { ledger in
            (ledger["trips"] as? [[String: Any]] ?? []).isEmpty
        }
    }

    @MainActor
    private func addSharedExpense(_ penny: Penny, amount: String, title: String) throws {
        try penny.tap(Shared.addExpense, opening: Shared.Screen.expenseForm)
        try penny.type(amount, into: Shared.formAmount)
        try penny.type(title, into: Shared.formTitle)
        try penny.tap(Shared.formSave)
        try penny.waitForAbsence(of: Shared.Screen.expenseForm, timeout: 20)
    }
}

extension Stack {
    /// Clears an entry's trip from another device (Edit entry › Trip › No trip).
    func moveToNoTrip(token: String, entryID: String) async throws {
        let current = try await ledger(token: token)
        var ledger = current.ledger
        ledger["transactions"] = (ledger["transactions"] as? [[String: Any]] ?? []).map { entry in
            var entry = entry
            if entry["id"] as? String == entryID { entry["tripId"] = nil }
            return entry
        }
        _ = try await send(
            "PUT", configuration.apiURL.appending(path: "api/ledger"),
            body: ["revision": current.revision, "ledger": ledger], token: token)
    }
}

@MainActor
extension Penny {
    /// The system's "Save Password?" sheet after a password sign-in sits over the app and
    /// swallows taps; Not Now dismisses it when it shows.
    /// Scrolls `screen`'s list up until `id` is on screen (a lazy list only builds visible rows).
    @discardableResult
    func scroll(to id: String, in screen: String, attempts: Int = 6) throws -> XCUIElement {
        let target = element(id)
        let list = app.collectionViews.matching(identifier: screen).firstMatch
        for _ in 0..<attempts {
            if target.waitForExistence(timeout: 2), target.isHittable { return target }
            list.swipeUp()
        }
        return try wait(for: id)
    }

    func scrollToTop(of screen: String) {
        let list = app.collectionViews.matching(identifier: screen).firstMatch
        for _ in 0..<3 { list.swipeDown() }
    }

    /// Taps `id` and waits for `screen`. The Save Password sheet can arrive late and swallow the
    /// tap, so it is dismissed and the tap tried again.
    func tap(_ id: String, opening screen: String) throws {
        for _ in 0..<3 {
            try tap(id)
            if element(screen).waitForExistence(timeout: 6) { return }
            dismissSavePassword(timeout: 2)
        }
        try wait(for: screen)
    }

    func dismissSavePassword(timeout: TimeInterval = 4) {
        let notNow = app.buttons["Not Now"].firstMatch
        if notNow.waitForExistence(timeout: timeout) { notNow.tap() }
    }

    /// Waits for a label, pulling `screen` to refresh while the change arrives.
    func waitForLabel(_ element: XCUIElement, containing text: String, on screen: String, timeout: TimeInterval = 30)
        throws
    {
        let deadline = Date().addingTimeInterval(timeout)
        while !element.label.contains(text) {
            guard Date() < deadline else {
                throw UIExpectationFailed(description: "\(element.identifier) never said \(text): \(element.label)")
            }
            pullHouseholdToRefresh(screen)
            _ = element.waitForExistence(timeout: 2)
        }
    }

    /// Waits until an element is gone, pulling to refresh while the other device's change arrives.
    func waitForAbsenceAfterRefresh(of id: String, on screen: String, timeout: TimeInterval = 30) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while element(id).exists {
            guard Date() < deadline else { throw UIExpectationFailed(description: "\(id) did not go away") }
            pullHouseholdToRefresh(screen)
            _ = element(id).waitForExistence(timeout: 2)
        }
    }

    /// Waits for an element on `screen` (not the iPad sidebar), pulling it to refresh meanwhile.
    func waitAfterRefresh(for id: String, on screen: String, timeout: TimeInterval = 30) throws {
        let target = element(id)
        let deadline = Date().addingTimeInterval(timeout)
        while !target.waitForExistence(timeout: 3) {
            guard Date() < deadline else { throw UIExpectationFailed(description: "\(id) did not appear") }
            pullHouseholdToRefresh(screen)
        }
    }
}
