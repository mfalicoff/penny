import Foundation
import PennyDomain
import Testing

/// "New receipt" notification payloads (MAZ-184) next to the household ones. Fixture ids only.
@Suite("Notification targets")
struct NotificationTargetTests {
    private static let item = "0123456789abcdef0123456789abcdef"

    @Test("whenThePayloadIsTheServersReceiptShape_NotificationTarget_ShouldOpenThatInboxItem")
    func receipt() throws {
        // The shape ReceiptInboxPushPayload sends (docs/reference/push.md), beside the aps dictionary.
        let payload: [AnyHashable: Any] = [
            "aps": [
                "alert": ["title": "New receipt", "body": "An emailed receipt is ready to attach."],
                "thread-id": "receipt-inbox",
            ],
            "inboxItemId": Self.item, "eventId": "fedcba9876543210fedcba9876543210",
        ]
        let target = try #require(NotificationTarget(userInfo: payload))
        #expect(target == .receiptInbox(try #require(ReceiptInboxNotification(inboxItemID: Self.item))))
        #expect(target.deepLink == .receiptInbox(itemID: Self.item))
        // The household reader never takes it.
        #expect(HouseholdNotification(userInfo: payload) == nil)
    }

    @Test("whenThePayloadIsAHouseholds_NotificationTarget_ShouldOpenAsBefore")
    func household() throws {
        let target = try #require(NotificationTarget(userInfo: ["householdId": "h1", "month": "2026-09"]))
        let month = try #require(MonthKey(year: 2026, month: 9))
        #expect(target.deepLink == .householdMonth(householdID: "h1", month: month, expenseID: nil))
    }

    @Test("whenTheReceiptPayloadIsMalformedOrMixed_NotificationTarget_ShouldOpenNothing")
    func malformed() {
        let payloads: [[AnyHashable: Any]] = [
            ["inboxItemId": ""],
            ["inboxItemId": 42],
            ["inboxItemId": "../inbox"],
            ["inboxItemId": "a/b"],
            ["inboxItemId": String(repeating: "a", count: 101)],
            ["inboxItemId": Self.item, "householdId": "h1", "month": "2026-09"],
            ["inboxItemId": Self.item, "expenseId": "e1"],
            ["url": "https://evil.example.test"],
        ]
        for payload in payloads {
            #expect(NotificationTarget(userInfo: payload) == nil, "\(payload)")
        }
    }

    @Test("whenANotificationOpensTheInbox_ShellRoute_ShouldShowItFromHome")
    func route() {
        var route = ShellRoute(tab: .activity)
        route.openSettings()
        route.open(.receiptInbox(itemID: Self.item))
        #expect(route.tab == .home)
        #expect(route.path(for: .home) == [.receiptInbox(itemID: Self.item)])
        #expect(!route.isSettingsPresented)
        #expect(!route.isAddEntryPresented)
    }
}
