import Foundation
import PennyAccessibility
import XCTest

private typealias IDs = AccessibilityID.Households

/// Two-person household journeys on the real API (MAZ-75, Full plan): the app is one member,
/// the stack's HTTP API is the other member's device. Nothing is mocked.
final class HouseholdJourneyTests: PennyUITestCase {
    /// Create → invite (code and QR) → the other person joins with the code → add an equal
    /// expense → they record their share as paid → the app shows it repaid → a concurrent edit
    /// is refused with Review latest → the creator can't leave while others remain.
    @MainActor
    func test_whenTwoPeopleShareAnExpense_Journey_ShouldSplitRecordAndRefuseStaleEdits() async throws {
        let stack = try await stack()
        let alex = try await makeAccount("household-alex")
        let bea = try await makeAccount("household-bea")
        let penny = try await launch()
        try penny.signIn(email: alex.email, password: alex.password)

        // Create a household.
        try penny.openShared()
        try penny.tap(IDs.create)
        try penny.wait(for: IDs.Screen.start)
        try penny.type("Apartment \(Device.name)", into: IDs.name)
        try penny.tap(IDs.createButton)
        try penny.wait(for: AccessibilityID.Screen.household, timeout: 20)
        let listed = try await stack.households(token: alex.token)
        let household = try XCTUnwrap(listed.first?["id"] as? String)
        screenshot("household-created")

        // Invite: the code is shown as text and as a QR code with its countdown.
        try penny.selectSegment("People", in: IDs.section)
        try penny.tap(IDs.invite)
        try penny.wait(for: IDs.Screen.invite)
        try penny.wait(for: IDs.inviteQR)
        try penny.wait(for: IDs.inviteExpires)
        let code = try penny.inviteCode()
        screenshot("invite")
        try await stack.join(token: bea.token, code: code)
        penny.app.buttons["Done"].firstMatch.tap()
        try penny.waitAfterRefresh(for: IDs.member(bea.userID))

        // Add an expense split equally between the two members.
        try penny.selectSegment("Expenses", in: IDs.section)
        try penny.tap(IDs.addExpense)
        try penny.wait(for: IDs.Screen.expenseForm)
        try penny.type("90", into: IDs.formAmount)
        try penny.type("Groceries", into: IDs.formTitle)
        try penny.wait(for: IDs.split(bea.userID))
        screenshot("shared-expense-form")
        try penny.tap(IDs.formSave)
        try penny.waitForAbsence(of: IDs.Screen.expenseForm, timeout: 20)
        let expenses = try await stack.waitForExpenses(token: bea.token, household: household) { $0.count == 1 }
        let expense = expenses[0]
        let expenseID = try XCTUnwrap(expense["id"] as? String)
        let splits = (expense["splits"] as? [[String: Any]] ?? []).compactMap { $0["amountCents"] as? Int }
        XCTAssertEqual(splits, [4500, 4500], "split equally between the two members on the server")
        XCTAssertNil(expense["accountId"], "the other member never receives the payer's account")
        try penny.wait(for: IDs.expense(expenseID))

        // The other member records that they paid their share; the app shows it repaid.
        try await stack.recordSharePayment(token: bea.token, household: household, expense: expense, from: bea.userID)
        try penny.tap(IDs.expense(expenseID))
        try penny.wait(for: AccessibilityID.Screen.householdExpense)
        let share = try penny.wait(for: IDs.share(bea.userID))
        try penny.waitForLabel(share, containing: "Repaid")
        XCTAssertFalse(penny.element(IDs.markPaid(bea.userID)).exists, "an already-paid share offers no payment")
        screenshot("expense-repaid")

        // A concurrent edit: open the form, the other member renames it, then save here.
        try penny.tap(IDs.expenseEdit)
        try penny.wait(for: IDs.Screen.expenseForm)
        let latest = try await stack.expenses(token: bea.token, household: household)[0]
        try await stack.renameExpense(token: bea.token, household: household, expense: latest, title: "Groceries (Bea)")
        try penny.type(" run", into: IDs.formTitle)
        try penny.tap(IDs.formSave)
        try penny.wait(for: IDs.formError, timeout: 20)
        try penny.tap(IDs.formReviewLatest)
        XCTAssertEqual(try penny.value(of: IDs.formTitle), "Groceries (Bea)", "nothing was overwritten")
        screenshot("stale-edit-reviewed")
        try penny.tap(IDs.formClose)
        try penny.waitForAbsence(of: IDs.Screen.expenseForm)

        // Membership restriction: the creator can't leave while another member remains.
        penny.app.navigationBars.buttons.element(boundBy: 0).tap()
        try penny.wait(for: AccessibilityID.Screen.household)
        try penny.selectSegment("People", in: IDs.section)
        try penny.tap(IDs.leave)
        try penny.dialogButton("Leave").tap()
        // The refusal shows at the top of the page.
        for _ in 0..<3 { penny.app.collectionViews.firstMatch.swipeDown() }
        try penny.wait(for: IDs.notice, timeout: 20)
        try penny.wait(for: IDs.member(alex.userID))
        screenshot("leave-refused")
    }

    /// A `penny://join` link for this server opens the join sheet with the code; joining opens
    /// the household. A link for another server asks first; a malformed link says why.
    @MainActor
    func test_whenAnInviteLinkIsOpened_Join_ShouldUseItForThisServerAndAskForAnother() async throws {
        let stack = try await stack()
        let owner = try await makeAccount("invite-owner")
        let guest = try await makeAccount("invite-guest")
        let household = try await stack.createHousehold(token: owner.token, name: "Cottage")
        let code = try await stack.invite(token: owner.token, household: household)
        let penny = try await launch()
        try penny.signIn(email: guest.email, password: guest.password)

        // Another server: confirmation, nothing joined.
        try penny.openJoinLink(code: code, server: "https://friends.example.test")
        try penny.wait(for: IDs.otherServer)
        screenshot("join-other-server")
        try penny.tap(IDs.startClose)

        // Malformed: refused with the reason.
        try penny.openURL("penny://join?code=not-a-code")
        try penny.wait(for: IDs.startError)
        try penny.tap(IDs.startClose)

        // This server: the code is filled in; Join opens the household.
        try penny.openJoinLink(code: code, server: stack.configuration.apiURL.absoluteString)
        try penny.wait(for: IDs.Screen.start)
        XCTAssertEqual(
            try penny.value(of: IDs.code)?.replacingOccurrences(of: " ", with: ""), code, "the link fills in the code")
        try penny.tap(IDs.joinButton)
        try penny.wait(for: AccessibilityID.Screen.household, timeout: 20)
        try penny.selectSegment("People", in: IDs.section)
        try penny.wait(for: IDs.member(guest.userID))
        screenshot("joined-by-link")
    }

    /// The scanner asks for the camera only when it opens; without one (the simulator has no
    /// camera, or access is denied) typed entry keeps working. An expired code says so.
    @MainActor
    func test_whenTheCameraCantBeUsed_Join_ShouldKeepTypedEntryAndExplainExpiredCodes() async throws {
        let guest = try await makeAccount("scanner")
        app.resetAuthorizationStatus(for: .camera)
        let penny = try await launch()
        try penny.signIn(email: guest.email, password: guest.password)
        try penny.openShared()
        try penny.tap(IDs.join)
        try penny.tap(IDs.scan)
        try penny.wait(for: IDs.Screen.scanner)
        penny.acceptSystemAlert("Don’t Allow", timeout: 3)
        try penny.wait(for: IDs.scannerDenied)
        screenshot("scanner-denied")
        try penny.tap(IDs.scannerTypeCode)
        try penny.waitForAbsence(of: IDs.Screen.scanner)
        try penny.type("FFFFF FFFFF", into: IDs.code)
        try penny.tap(IDs.joinButton)
        try penny.wait(for: IDs.startError, timeout: 20)
        screenshot("invite-expired")
    }
}

@MainActor
extension Penny {
    /// The Shared tab (iPhone) or sidebar row (iPad).
    func openShared() throws {
        if Device.isPad {
            try tap(AccessibilityID.Sidebar.item("shared"))
        } else {
            let tab = app.buttons.matching(identifier: AccessibilityID.Tab.tab("shared")).firstMatch
            let button = tab.waitForExistence(timeout: 5) ? tab : app.tabBars.buttons["Shared"]
            for _ in 0..<3 {
                button.tap()
                if element(AccessibilityID.Screen.shared).waitForExistence(timeout: 8) { return }
            }
        }
        try wait(for: AccessibilityID.Screen.shared, timeout: 20)
    }

    /// Chooses a segment of a segmented picker by its title.
    func selectSegment(_ title: String, in id: String) throws {
        let picker = try wait(for: id)
        let segment = picker.buttons[title].exists ? picker.buttons[title] : app.buttons[title].firstMatch
        guard segment.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No \(title) segment in \(id)")
        }
        segment.tap()
    }

    /// The invite code as the server issued it (the label spells it out for VoiceOver).
    func inviteCode() throws -> String {
        let label = try wait(for: AccessibilityID.Households.inviteCode).label
        let code = label.replacingOccurrences(of: "Invite code", with: "")
            .replacingOccurrences(of: ",", with: "").replacingOccurrences(of: " ", with: "")
        guard code.count == 10 else { throw UIExpectationFailed(description: "Unreadable invite code \(label)") }
        return code
    }

    /// Waits for an element, pulling to refresh while the other device's change arrives.
    func waitAfterRefresh(for id: String, timeout: TimeInterval = 30) throws {
        let target = element(id)
        let deadline = Date().addingTimeInterval(timeout)
        while !target.waitForExistence(timeout: 3) {
            guard Date() < deadline else { throw UIExpectationFailed(description: "\(id) did not appear") }
            pullToRefresh()
        }
    }

    func waitForLabel(_ element: XCUIElement, containing text: String, timeout: TimeInterval = 30) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !element.label.contains(text) {
            guard Date() < deadline else {
                throw UIExpectationFailed(description: "\(element.identifier) never said \(text): \(element.label)")
            }
            pullToRefresh()
            _ = element.waitForExistence(timeout: 2)
        }
    }

    func openJoinLink(code: String, server: String) throws {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let encoded = server.addingPercentEncoding(withAllowedCharacters: allowed) ?? server
        try openURL("penny://join?code=\(code)&server=\(encoded)")
    }

    /// Opens a `penny://` URL the way the Camera app or another app would: through the system,
    /// so the running app receives it (`XCUIApplication.open` relaunches with the launch
    /// environment, which would reset the app).
    func openURL(_ text: String) throws {
        guard let url = URL(string: text) else { throw UIExpectationFailed(description: "Bad URL \(text)") }
        XCUIDevice.shared.system.open(url)
        // iOS may ask whether to open the link in Penny.
        let open = Penny.springboard.buttons["Open"]
        if open.waitForExistence(timeout: 2) { open.tap() }
    }
}
