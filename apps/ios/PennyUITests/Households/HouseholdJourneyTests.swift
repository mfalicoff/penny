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
        try penny.showHouseholdSection("People")
        // Invite is in the … menu on the iPhone People section, a toolbar button otherwise.
        try penny.tapHouseholdAction(IDs.invite, titled: "Invite someone")
        try penny.wait(for: IDs.Screen.invite)
        try penny.wait(for: IDs.inviteQR)
        try penny.wait(for: IDs.inviteExpires)
        let code = try penny.inviteCode()
        screenshot("invite")
        try await stack.join(token: bea.token, code: code)
        penny.app.buttons["Done"].firstMatch.tap()
        try penny.waitAfterRefresh(for: IDs.member(bea.userID))

        // Add an expense split equally between the two members.
        try penny.showHouseholdSection("Expenses")
        try penny.tap(IDs.addExpense)
        try penny.wait(for: IDs.Screen.expenseForm)
        try penny.enterAmount("90", into: IDs.formAmount)
        try penny.type("Groceries", into: IDs.formTitle)
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
        // The wide iPad page selects the expense beside the list (`ipad-shared`); its page opens from
        // Edit, history and receipt.
        if Device.isPad, !penny.element(AccessibilityID.Screen.householdExpense).waitForExistence(timeout: 5) {
            try penny.tap(IDs.selectedExpenseOpen)
        }
        try penny.wait(for: AccessibilityID.Screen.householdExpense)
        try penny.wait(for: IDs.share(bea.userID))
        // Their row trades Mark as paid for a green Paid beside the name and amount.
        try penny.waitForPaidShare(of: bea.userID)
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
        // Back to the household (the back button is titled with its name).
        let back = penny.app.navigationBars.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@ OR label == %@", "Apartment", "Back")).firstMatch
        (back.waitForExistence(timeout: 5) ? back : penny.app.navigationBars.buttons.element(boundBy: 0)).tap()
        try penny.wait(for: AccessibilityID.Screen.household, timeout: 20)
        try penny.showHouseholdSection("People")
        try penny.tapHouseholdAction(IDs.leave, titled: "Leave household")
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
        try penny.showHouseholdSection("People")
        try penny.waitAfterRefresh(for: IDs.member(guest.userID))
        screenshot("joined-by-link")
    }

    /// A join link that arrives over Settings › Currency (the iPad detail column, the iPhone
    /// sheet) closes Settings first, then presents the join sheet in a later update: presenting
    /// it while the column swaps crashed SwiftUI, and over a closing sheet it never appeared.
    @MainActor
    func test_whenAJoinLinkArrivesOverSettings_Join_ShouldCloseSettingsThenOpenTheJoinSheet() async throws {
        let stack = try await stack()
        let owner = try await makeAccount("over-settings-owner")
        let guest = try await makeAccount("over-settings-guest")
        let household = try await stack.createHousehold(token: owner.token, name: "Studio")
        let code = try await stack.invite(token: owner.token, household: household)
        let penny = try await launch()
        try penny.signIn(email: guest.email, password: guest.password)
        try penny.openSettingsPage("currency", screen: AccessibilityID.Screen.currency)
        screenshot("settings-currency-before-link")

        try penny.openJoinLink(code: code, server: stack.configuration.apiURL.absoluteString)
        try penny.wait(for: IDs.Screen.start, timeout: 20)
        try penny.waitForAbsence(of: AccessibilityID.Screen.currency)
        XCTAssertEqual(try penny.value(of: IDs.code)?.replacingOccurrences(of: " ", with: ""), code)
        screenshot("join-over-settings")
        try penny.tap(IDs.joinButton)
        try penny.wait(for: AccessibilityID.Screen.household, timeout: 20)
    }

    /// Recurring lists a household's shared schedule with the personal ones; tapping its row
    /// opens the household with the schedule's form over it (MAZ-198's routing, tapped for real).
    @MainActor
    func test_whenASharedScheduleIsTappedOnRecurring_Household_ShouldOpenWithItsForm() async throws {
        let stack = try await stack()
        let alex = try await makeAccount("shared-schedule")
        let household = try await stack.createHousehold(token: alex.token, name: "Maison \(Device.name)")
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let nextDate = formatter.string(from: Date().addingTimeInterval(10 * 86_400))
        let rule = try await stack.createSharedRecurring(
            token: alex.token, household: household, payer: alex.userID, title: "Streaming", cents: 1600,
            nextDate: nextDate)
        let penny = try await launch()
        try penny.signIn(email: alex.email, password: alex.password)

        try penny.openSettingsPage("recurring", screen: AccessibilityID.Screen.recurring)
        let row = AccessibilityID.Organize.sharedSchedule(rule)
        try penny.wait(for: row, timeout: 20)
        screenshot("recurring-shared-schedule")
        try penny.tap(row)

        try penny.wait(for: AccessibilityID.Screen.household, timeout: 20)
        try penny.wait(for: IDs.Screen.expenseForm, timeout: 20)
        XCTAssertEqual(try penny.value(of: IDs.formTitle), "Streaming", "the tapped schedule's form is open")
        try penny.waitForAbsence(of: AccessibilityID.Screen.recurring)
        screenshot("shared-schedule-form-over-household")
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
            let row = try sidebarRow(AccessibilityID.Sidebar.item("shared"))
            for _ in 0..<3 {
                row.tap()
                if element(AccessibilityID.Screen.shared).waitForExistence(timeout: 8) { return }
            }
        } else {
            let tab = app.buttons.matching(identifier: AccessibilityID.Tab.tab("shared")).firstMatch
            // The cards' tab bar (`PennyTabBar`, MAZ-254) is found by its identifier.
            guard tab.waitForExistence(timeout: Penny.timeout) else {
                throw UIExpectationFailed(description: "No Shared tab")
            }
            let button = tab
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

    /// A household action: its own button where the page shows one (the toolbar's Invite, the iPad
    /// People column's actions), else the item with that title in the … menu, whose items carry no
    /// identifier (SwiftUI drops it from menu items).
    func tapHouseholdAction(_ id: String, titled title: String) throws {
        let direct = element(id)
        if direct.waitForExistence(timeout: 3), direct.isHittable { return direct.tap() }
        if Device.isPad {
            // The wide iPad household keeps its actions at the end of the People column, the
            // second of its two lists (both are `screen.household`).
            let lists = app.collectionViews.matching(identifier: AccessibilityID.Screen.household)
            let list = lists.element(boundBy: max(lists.count - 1, 0))
            for _ in 0..<5 where !(direct.exists && direct.isHittable) && list.exists { list.swipeUp() }
            if direct.exists, direct.isHittable { return direct.tap() }
        }
        try tap(AccessibilityID.Households.more)
        let item = app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
        guard item.waitForExistence(timeout: Penny.timeout) else {
            throw UIExpectationFailed(description: "No \(title) in the household's … menu")
        }
        item.tap()
    }

    /// Shows a household section: its segment where the page has one (iPhone, a narrow iPad
    /// column), nothing where the wide iPad page shows the expenses with the balances and people
    /// beside them and has no segments (`ipad-shared`, MAZ-182).
    func showHouseholdSection(_ title: String) throws {
        let picker = element(AccessibilityID.Households.section)
        guard picker.waitForExistence(timeout: Device.isPad ? 3 : Penny.timeout) else {
            if Device.isPad { return }
            throw UIExpectationFailed(description: "No household sections")
        }
        try selectSegment(title, in: AccessibilityID.Households.section)
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
            pullHouseholdToRefresh()
        }
    }

    /// Pulls the household page (not the iPad sidebar, the first list on screen) to refresh.
    func pullHouseholdToRefresh(_ screen: String = AccessibilityID.Screen.household) {
        let page = app.collectionViews.matching(identifier: screen).firstMatch
        guard page.exists else { return pullToRefresh() }
        let top = page.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        top.press(forDuration: 0.05, thenDragTo: page.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
    }

    func waitForLabel(_ element: XCUIElement, containing text: String, timeout: TimeInterval = 30) throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !element.label.contains(text) {
            guard Date() < deadline else {
                throw UIExpectationFailed(description: "\(element.identifier) never said \(text): \(element.label)")
            }
            pullHouseholdToRefresh(AccessibilityID.Screen.householdExpense)
            _ = element.waitForExistence(timeout: 2)
        }
    }

    /// Waits, pulling to refresh, until a member's share shows as paid: no Mark as paid for it, and
    /// the green Paid beside their name (a separate element from the name and amount).
    func waitForPaidShare(of userID: String, timeout: TimeInterval = 30) throws {
        let markPaid = element(AccessibilityID.Households.markPaid(userID))
        let paid = app.staticTexts.matching(NSPredicate(format: "label == %@", "Paid")).firstMatch
        let deadline = Date().addingTimeInterval(timeout)
        while markPaid.exists || !paid.waitForExistence(timeout: 2) {
            guard Date() < deadline else {
                throw UIExpectationFailed(description: "The share of \(userID) never showed as paid")
            }
            pullHouseholdToRefresh(AccessibilityID.Screen.householdExpense)
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
