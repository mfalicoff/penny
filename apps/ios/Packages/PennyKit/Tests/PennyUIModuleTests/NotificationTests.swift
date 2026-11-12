import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

@testable import PennyUI

/// Notification Center, the permission prompt and APNs, as the system would answer.
@MainActor
private final class FakeNotificationSystem: NotificationSystem {
    var current: PushPermission = .notDetermined
    var grants = true
    private(set) var prompts = 0
    private(set) var registrations = 0
    private(set) var clears = 0

    func permission() async -> PushPermission { current }

    func requestPermission() async -> Bool {
        prompts += 1
        if current == .notDetermined { current = grants ? .allowed : .denied }
        return current == .allowed
    }

    func registerForRemoteNotifications() { registrations += 1 }
    func removeDeliveredNotifications() { clears += 1 }
}

/// Answers every push request with `{ok:true}` and records it; any other request fails.
private final class PushServer: HTTPTransport {
    private let log = Mutex<[String]>([])
    var calls: [String] { log.withLock { $0 } }

    func send(_ request: URLRequest) async throws -> HTTPResult {
        let path = request.url?.path() ?? ""
        log.withLock { $0.append("\(request.httpMethod ?? "") \(path)") }
        guard path == "/api/push/devices" else { throw URLError(.notConnectedToInternet) }
        return HTTPResult(status: 200, headers: [:], body: Data(#"{"ok":true}"#.utf8))
    }
}

/// Opening household notifications and the registration lifecycle in the app (MAZ-79), with
/// payloads injected in process as the app delegate hands them over. Fixture ids only.
@Suite("Household notifications in the app")
@MainActor
struct NotificationTests {
    private let today = CalendarDate(year: 2026, month: 11, day: 9) ?? .earliest
    private let server = PushServer()
    private static let server = (try? ServerURL("https://penny.example.test"))!
    private static let token = Data((0..<32).map { UInt8($0) })

    private func notifications(_ system: FakeNotificationSystem) -> PushNotifications {
        let suite = "penny.tests.notifications.\(UUID().uuidString)"
        return PushNotifications(
            system: system, environment: .sandbox, store: PushRegistrationStore(suiteName: suite),
            defaults: UserDefaults(suiteName: suite) ?? .standard)
    }

    private func account(_ email: String) throws -> PushAccount {
        let session = try ServerSession(server: Self.server, email: email, token: String(repeating: "ab", count: 32))
        let client = try APIClient(
            configuration: APIConfiguration(server: Self.server), session: session, transport: server)
        return try #require(PushAccount(client: client))
    }

    private static let expense: [AnyHashable: Any] = ["householdId": "h1", "month": "2026-09", "expenseId": "e2"]

    @Test("whenANotificationOpensBeforeSignIn_PushNotifications_ShouldWaitAndOpenItInTheAccount")
    func coldStart() async throws {
        let system = FakeNotificationSystem()
        let push = notifications(system)
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }

        // Cold start: the tap is handed over while the app is still restoring the session.
        push.didOpen(HouseholdNotification(userInfo: Self.expense))
        #expect(opened.isEmpty, "nothing opens before an account is signed in")
        await push.accountChanged(nil)  // the demo, or still signed out
        #expect(opened.isEmpty, "never in the demo")
        await push.accountChanged(try account("alex@example.test"))
        let month = try #require(MonthKey(year: 2026, month: 9))
        #expect(opened == [.householdMonth(householdID: "h1", month: month, expenseID: "e2")])
        #expect(push.pending == nil)
    }

    @Test("whenANotificationOpensWhileSignedIn_PushNotifications_ShouldOpenItAtOnce")
    func warmStart() async throws {
        let push = notifications(FakeNotificationSystem())
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }
        await push.accountChanged(try account("alex@example.test"))
        push.didOpen(HouseholdNotification(userInfo: ["householdId": "h1", "month": "2026-10"]))
        #expect(opened.count == 1)
    }

    @Test("whenThePayloadIsMalformed_PushNotifications_ShouldOpenNothing")
    func malformed() async throws {
        let push = notifications(FakeNotificationSystem())
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }
        await push.accountChanged(try account("alex@example.test"))
        push.didOpen(HouseholdNotification(userInfo: ["householdId": "../h1", "month": "2026-10"]))
        push.didOpen(HouseholdNotification(userInfo: ["url": "https://evil.example.test"]))
        #expect(opened.isEmpty)
        #expect(push.rejectedCount == 2)
    }

    @Test("whenANotificationIsForAnotherAccount_PushNotifications_ShouldNeverOpenOrShowIt")
    func otherAccount() async throws {
        let system = FakeNotificationSystem()
        system.current = .allowed
        let push = notifications(system)
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }
        await push.becameActive()
        await push.accountChanged(try account("alex@example.test"))
        await push.didRegister(deviceToken: Self.token)
        #expect(push.registrar.status == .registered)

        // Alex's session expires (no sign-out request): the registration stays Alex's, and
        // Alex's notifications leave Notification Center.
        await push.accountChanged(nil)
        #expect(system.clears == 1)
        // One of Alex's notifications tapped now waits for an account; Bea signs in, and it is
        // dropped rather than opened in her account.
        push.didOpen(HouseholdNotification(userInfo: Self.expense))
        #expect(opened.isEmpty)
        let bea = try account("bea@example.test")
        await push.accountChanged(bea)
        #expect(opened.isEmpty && push.rejectedCount == 1)
        #expect(push.registrar.owner == bea.owner, "the token moved to Bea")

        // Bea's own notifications open and show.
        push.didOpen(HouseholdNotification(userInfo: Self.expense))
        #expect(opened.count == 1)

        #expect(push.showsInForeground(HouseholdNotification(userInfo: Self.expense)))
        #expect(!push.showsInForeground(nil), "a malformed payload never shows")
        await push.accountChanged(nil)
        #expect(!push.showsInForeground(HouseholdNotification(userInfo: Self.expense)), "nobody is signed in")
    }

    @Test("whenTheStoredRegistrationIsAnotherAccounts_PushNotifications_ShouldDropTheTap")
    func dropsForeignTap() async throws {
        let system = FakeNotificationSystem()
        system.current = .allowed
        let push = notifications(system)
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }
        await push.becameActive()
        await push.accountChanged(try account("alex@example.test"))
        await push.didRegister(deviceToken: Self.token)
        await push.accountChanged(nil)  // Alex's session expired

        // Bea signs in on a server that can't be reached: her registration fails, so the device
        // is still Alex's. A tap on a leftover notification never opens in Bea's account.
        let unreachable = try ServerURL("https://offline.example.test")
        let session = try ServerSession(
            server: unreachable, email: "bea@example.test", token: String(repeating: "cd", count: 32))
        let failing = try APIClient(
            configuration: APIConfiguration(server: unreachable), session: session, transport: OfflineTransport())
        push.didOpen(HouseholdNotification(userInfo: Self.expense))
        await push.accountChanged(PushAccount(client: failing))
        #expect(opened.isEmpty)
        #expect(push.rejectedCount == 1)
        #expect(!push.showsInForeground(HouseholdNotification(userInfo: Self.expense)))
    }

    @Test("whenThePersonTurnsNotificationsOn_PushNotifications_ShouldAskOnceAndRegister")
    func contextualPermission() async throws {
        let system = FakeNotificationSystem()
        let push = notifications(system)
        await push.becameActive()
        #expect(system.prompts == 0, "never asked at launch")
        #expect(!push.offersPrompt, "nothing to offer while signed out")
        await push.accountChanged(try account("alex@example.test"))
        #expect(push.offersPrompt)
        #expect(system.registrations == 0, "no token is requested before permission")

        await push.requestPermission()
        #expect(system.prompts == 1)
        #expect(push.permission == .allowed && !push.offersPrompt)
        #expect(system.registrations == 1)
        await push.didRegister(deviceToken: Self.token)
        #expect(push.registrar.status == .registered)
        #expect(server.calls == ["POST /api/push/devices"])
    }

    @Test("whenThePersonDeclines_PushNotifications_ShouldStopOfferingAndKeepWorking")
    func declined() async throws {
        let system = FakeNotificationSystem()
        system.grants = false
        let push = notifications(system)
        await push.accountChanged(try account("alex@example.test"))
        await push.requestPermission()
        #expect(push.permission == .denied && !push.offersPrompt)
        #expect(system.registrations == 0 && server.calls.isEmpty)
        #expect(NotificationText.value(permission: .denied, status: push.registrar.status) == "Off in Settings")

        let other = notifications(FakeNotificationSystem())
        await other.accountChanged(try account("alex@example.test"))
        other.dismissPrompt()
        #expect(!other.offersPrompt, "Not now hides the Shared tab's offer")
    }

    @Test("whenAPNsIsUnavailable_PushNotifications_ShouldSaySoAndKeepTheAppWorking")
    func unavailable() async throws {
        let system = FakeNotificationSystem()
        system.current = .allowed
        let push = notifications(system)
        await push.becameActive()
        await push.accountChanged(try account("alex@example.test"))
        push.didFailToRegister()
        #expect(push.registrar.status == .unavailable)
        #expect(NotificationText.value(permission: .allowed, status: .unavailable) == "Unavailable")
        await push.didRegister(deviceToken: Data(count: 4))
        #expect(push.registrar.status == .unavailable, "a token APNs would never issue is refused")
        #expect(server.calls.isEmpty)
    }

    @Test("whenANotificationOpensAHouseholdMonth_ShellModel_ShouldShowThatMonthFromShared")
    func shellOpensMonth() throws {
        let client = try APIClient(configuration: APIConfiguration(server: Self.server), transport: server)
        let shell = ShellModel(
            workspace: FixedWorkspace(load: .ready(Ledger())), session: .demo, today: today,
            households: APIHouseholdService(client: client), householdEmail: "alex@example.test")
        shell.navigate { $0.openSettings() }
        let month = try #require(MonthKey(year: 2026, month: 9))
        shell.open(.householdMonth(householdID: "h1", month: month, expenseID: "e2"))
        #expect(shell.route.tab == .shared)
        #expect(
            shell.route.path(for: .shared) == [
                .household(id: "h1"), .householdExpense(householdID: "h1", expenseID: "e2"),
            ])
        let model = try #require(shell.households.model(for: "h1"))
        #expect(model.month == month)
        // The page follows the calendar again only once the month on screen rolls over.
        model.followCurrentMonth(MonthKey(today))
        #expect(model.month == month, "opening the page keeps the notification's month")
    }
}

private struct OfflineTransport: HTTPTransport {
    func send(_ request: URLRequest) async throws -> HTTPResult { throw URLError(.notConnectedToInternet) }
}
