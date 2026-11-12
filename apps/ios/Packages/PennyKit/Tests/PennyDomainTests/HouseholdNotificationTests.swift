import Foundation
import PennyDomain
import Testing

/// Household notification payloads and where they open (MAZ-79). Fixture ids only.
@Suite("Household notifications")
struct HouseholdNotificationTests {
    private static let month = MonthKey(year: 2026, month: 9)

    @Test("whenThePayloadIsTheServers_HouseholdNotification_ShouldOpenTheMonthOrTheExpense")
    func valid() throws {
        // The shape PushPayload sends (docs/migration/push.md), with the aps dictionary beside it.
        let expense: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "New household expense"], "thread-id": "household-h_1"],
            "householdId": "h_1", "month": "2026-09", "expenseId": "e-2", "eventId": "evt 1",
        ]
        let note = try #require(HouseholdNotification(userInfo: expense))
        #expect(note.householdID == "h_1" && note.month == Self.month && note.expenseID == "e-2")
        #expect(note.deepLink == .householdMonth(householdID: "h_1", month: try #require(Self.month), expenseID: "e-2"))

        // Reimbursements carry no expense.
        let reimbursement = try #require(HouseholdNotification(userInfo: ["householdId": "h_1", "month": "2026-09"]))
        #expect(reimbursement.expenseID == nil)
    }

    @Test("whenThePayloadIsMalformed_HouseholdNotification_ShouldOpenNothing")
    func malformed() {
        let payloads: [[AnyHashable: Any]] = [
            [:],
            ["householdId": "h1"],
            ["month": "2026-09"],
            ["householdId": "h1", "month": "2026-9"],
            ["householdId": "h1", "month": "2026-13"],
            ["householdId": "h1", "month": "2026-00"],
            ["householdId": "h1", "month": "２０２６-09"],
            ["householdId": "h1", "month": "2026-09-01"],
            ["householdId": "h1", "month": 202_609],
            ["householdId": 42, "month": "2026-09"],
            ["householdId": "", "month": "2026-09"],
            ["householdId": "../h1", "month": "2026-09"],
            ["householdId": "h1/expenses/e1", "month": "2026-09"],
            ["householdId": "https://evil.example.test", "month": "2026-09"],
            ["householdId": String(repeating: "a", count: 101), "month": "2026-09"],
            ["householdId": "h1", "month": "2026-09", "expenseId": ""],
            ["householdId": "h1", "month": "2026-09", "expenseId": "e 1"],
            ["householdId": "h1", "month": "2026-09", "expenseId": 7],
            ["householdId": "h1", "month": "2026-09", "expenseId": NSNull()],
        ]
        for (index, payload) in payloads.enumerated() {
            #expect(HouseholdNotification(userInfo: payload) == nil, "payload \(index)")
        }
    }

    @Test("whenTheLegacyNotificationRouteIsOpened_DeepLink_ShouldKeepTheMonthAndExpense")
    func legacyRoute() throws {
        let month = try #require(Self.month)
        #expect(
            DeepLink(url: try #require(URL(string: "penny:///households/h1?month=2026-09&expenseId=e2")))
                == .householdMonth(householdID: "h1", month: month, expenseID: "e2"))
        #expect(
            DeepLink(url: try #require(URL(string: "penny://households/h1?month=2026-09")))
                == .householdMonth(householdID: "h1", month: month, expenseID: nil))
        // Without a valid month (or with a bad expense id) the household opens as before.
        #expect(
            DeepLink(url: try #require(URL(string: "penny:///households/h1?month=09-2026"))) == .household(id: "h1"))
        #expect(
            DeepLink(url: try #require(URL(string: "penny:///households/h1?month=2026-09&expenseId=e%202")))
                == .household(id: "h1"))
    }

    @Test("whenANotificationOpens_ShellRoute_ShouldShowItFromTheSharedRootWithABackPath")
    func routing() throws {
        let month = try #require(Self.month)
        var route = ShellRoute(tab: .activity)
        route.openSettings(.accounts)
        route.open(.householdMonth(householdID: "h1", month: month, expenseID: "e2"))
        #expect(route.tab == .shared)
        #expect(
            route.path(for: .shared) == [.household(id: "h1"), .householdExpense(householdID: "h1", expenseID: "e2")])
        #expect(!route.isSettingsPresented, "nothing hides the destination")

        route.open(.householdMonth(householdID: "h1", month: month, expenseID: nil))
        #expect(route.path(for: .shared) == [.household(id: "h1")], "Back leads to the Shared list")
    }

    @Test("whenANotificationArrivesSignedOutOrLocked_DeepLinkInbox_ShouldKeepItForTheNextAccountOnly")
    func gate() throws {
        let link = DeepLink.householdMonth(householdID: "h1", month: try #require(Self.month), expenseID: nil)
        var inbox = DeepLinkInbox()
        inbox.receive(link)  // cold start: nobody is signed in yet
        #expect(inbox.take(ready: true, for: .demo) == nil, "never in the demo")
        #expect(inbox.take(ready: false, for: .account("a")) == nil, "never behind the lock")
        #expect(inbox.take(ready: true, for: .account("a")) == link)

        inbox.sessionChanged(to: .account("a"))
        inbox.receive(link)
        #expect(inbox.take(ready: true, for: .account("b")) == nil, "another account never opens it")
        #expect(inbox.pending == nil)
    }

    @Test("whenATokenArrives_PushDeviceToken_ShouldBeLowerCaseHexWithinTheServersLimits")
    func token() throws {
        let bytes = Data((0..<32).map { UInt8($0 * 7 % 256) })
        let token = try #require(PushDeviceToken(bytes))
        #expect(token.hex.count == 64 && token.hex == token.hex.lowercased())
        #expect(PushDeviceToken(hex: token.hex.uppercased()) == token)
        #expect(!"\(token)".contains(token.hex), "never printed")
        #expect(PushDeviceToken(Data(count: 31)) == nil)
        #expect(PushDeviceToken(Data(count: 101)) == nil)
        #expect(PushDeviceToken(hex: String(repeating: "a", count: 63)) == nil)
        #expect(PushDeviceToken(hex: String(repeating: "g", count: 64)) == nil)
        #expect(PushDeviceToken(hex: "ExponentPushToken[abc]") == nil)
    }
}
