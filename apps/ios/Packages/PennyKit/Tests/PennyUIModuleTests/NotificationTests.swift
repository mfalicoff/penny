import Foundation
import PennyDomain
import Security
import Synchronization
import Testing

@testable import PennyData
@testable import PennyUI

/// One device's Keychain for the owner key (a host test process has no usable Keychain).
private final class MemoryKeychain: KeychainBackend {
    private let items = Mutex<[String: Data]>([:])

    private static func id(_ query: [String: Any]) -> String {
        "\(query[kSecAttrService as String] ?? "") \(query[kSecAttrAccount as String] ?? "")"
    }

    func copyData(_ query: [String: Any]) -> (OSStatus, Data?) {
        items.withLock { $0[Self.id(query)] }.map { (errSecSuccess, $0) } ?? (errSecItemNotFound, nil)
    }

    func add(_ attributes: [String: Any]) -> OSStatus {
        items.withLock { items in
            let id = Self.id(attributes)
            guard items[id] == nil else { return errSecDuplicateItem }
            items[id] = attributes[kSecValueData as String] as? Data
            return errSecSuccess
        }
    }

    func update(_ query: [String: Any], _ attributes: [String: Any]) -> OSStatus { errSecUnimplemented }
    func delete(_ query: [String: Any]) -> OSStatus { errSecUnimplemented }
}

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
    private let keychain = MemoryKeychain()
    private static let server = (try? ServerURL("https://penny.example.test"))!
    private static let token = Data((0..<32).map { UInt8($0) })

    /// A fresh process on this test's device; `suite` keeps the stored registration across them.
    private func notifications(
        _ system: FakeNotificationSystem, suite: String = "penny.tests.notifications.\(UUID().uuidString)"
    ) -> PushNotifications {
        PushNotifications(
            system: system, environment: .sandbox, store: PushRegistrationStore(suiteName: suite, keychain: keychain),
            defaults: UserDefaults(suiteName: suite) ?? .standard)
    }

    private func account(_ email: String, transport: (any HTTPTransport)? = nil) throws -> PushAccount {
        let session = try ServerSession(server: Self.server, email: email, token: String(repeating: "ab", count: 32))
        let client = try APIClient(
            configuration: APIConfiguration(server: Self.server), session: session, transport: transport ?? server)
        return try #require(PushAccount(client: client, store: PushRegistrationStore(keychain: keychain)))
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
        #expect(push.pending == nil, "nothing is kept for later either")
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
        #expect(opened.isEmpty && push.pending == nil, "dropped, not kept")
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
        await push.accountChanged(push.account(for: failing))
        #expect(opened.isEmpty)
        #expect(push.pending == nil)
        #expect(!push.showsInForeground(HouseholdNotification(userInfo: Self.expense)))
    }

    @Test("whenSignOutCouldNotReachTheServer_PushNotifications_ShouldKeepThePreviousAccountsNotificationsFromTheNext")
    func offlineSignOut() async throws {
        let system = FakeNotificationSystem()
        system.current = .allowed
        let push = notifications(system)
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }
        await push.becameActive()
        await push.accountChanged(try account("alex@example.test"))
        await push.didRegister(deviceToken: Self.token)

        // "Sign out anyway" offline: the DELETE fails, so the server may still send Alex's
        // notifications to this device.
        await push.devices.unregister(using: try account("alex@example.test", transport: OfflineTransport()).client)
        await push.accountChanged(nil)
        #expect(push.registrar.owner != nil, "the device stays Alex's")

        // Bea signs in, and her registration fails too: Alex's notifications neither show nor open.
        let bea = try account("bea@example.test", transport: OfflineTransport())
        await push.accountChanged(bea)
        #expect(!push.showsInForeground(HouseholdNotification(userInfo: Self.expense)))
        push.didOpen(HouseholdNotification(userInfo: Self.expense))
        #expect(opened.isEmpty && push.pending == nil)
    }

    @Test("whenNotificationsWereTurnedOffBeforeTheAccountChanged_PushNotifications_ShouldStillDropThePreviousAccounts")
    func deniedThenAccountChange() async throws {
        let system = FakeNotificationSystem()
        system.current = .allowed
        let push = notifications(system)
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }
        await push.becameActive()
        let alex = try account("alex@example.test")
        await push.accountChanged(alex)
        await push.didRegister(deviceToken: Self.token)
        system.current = .denied
        await push.becameActive()
        #expect(server.calls == ["POST /api/push/devices", "DELETE /api/push/devices"])
        #expect(push.registrar.owner == alex.owner, "removed on the server, still Alex's on this device")

        await push.accountChanged(nil)
        await push.accountChanged(try account("bea@example.test"))
        #expect(!push.showsInForeground(HouseholdNotification(userInfo: Self.expense)))
        push.didOpen(HouseholdNotification(userInfo: Self.expense))
        #expect(opened.isEmpty)
    }

    @Test("whenTheAppLaunchesIntoAnotherAccountThanTheRegistrations_PushNotifications_ShouldClearDeliveredOnes")
    func coldLaunchClears() async throws {
        let suite = "penny.tests.notifications.\(UUID().uuidString)"
        let first = FakeNotificationSystem()
        first.current = .allowed
        let earlier = notifications(first, suite: suite)
        await earlier.becameActive()
        await earlier.accountChanged(try account("alex@example.test"))
        await earlier.didRegister(deviceToken: Self.token)

        // Next launch, still Alex: the notifications stay.
        let same = FakeNotificationSystem()
        await notifications(same, suite: suite).accountChanged(try account("alex@example.test"))
        #expect(same.clears == 0)

        // Next launch, Bea is signed in (Alex's session ended without this process seeing it).
        let next = FakeNotificationSystem()
        let push = notifications(next, suite: suite)
        await push.accountChanged(nil)  // restoring
        #expect(next.clears == 0)
        await push.accountChanged(try account("bea@example.test"))
        #expect(next.clears == 1)
    }

    @Test("whenADevelopmentBuildStoredAnUnkeyedOwner_PushNotifications_ShouldStillOpenThatAccountsTap")
    func legacyOwner() async throws {
        let suite = "penny.tests.notifications.\(UUID().uuidString)"
        let legacy = PushOwner.legacy(AccountScope(server: Self.server, email: "alex@example.test"))
        let token = try #require(PushDeviceToken(Self.token))
        // As a development build stored it: the registration only, with the unkeyed digest.
        let data = try JSONEncoder().encode(StoredPushRegistration(token: token, environment: .sandbox, owner: legacy))
        UserDefaults(suiteName: suite)?.set(data, forKey: "penny.push.registration")

        let system = FakeNotificationSystem()
        let push = notifications(system, suite: suite)
        var opened: [DeepLink] = []
        push.deliver = { opened.append($0) }
        push.didOpen(HouseholdNotification(userInfo: Self.expense))
        let alex = try account("alex@example.test")
        await push.accountChanged(alex)
        #expect(opened.count == 1 && system.clears == 0)
        #expect(push.registrar.owner == alex.owner)
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
