import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

/// APNs registration (MAZ-79) against a stub server: the request shapes, the lifecycle
/// (permission, token, refresh, account change, denial, sign-out) and stale answers. Fixture
/// tokens and `.test` servers only; nothing calls Apple.
@Suite("Push registration")
@MainActor
struct PushRegistrationTests {
    private static let tokenA = PushDeviceToken(hex: String(repeating: "a1", count: 32))!
    private static let tokenB = PushDeviceToken(hex: String(repeating: "b2", count: 32))!

    /// A UserDefaults suite of its own per test.
    private let store = PushRegistrationStore(suiteName: "penny.tests.push.\(UUID().uuidString)")

    nonisolated private static func ok(_ request: URLRequest) -> HTTPResult {
        HTTPResult(status: request.httpMethod == "POST" ? 201 : 200, headers: [:], body: Data(#"{"ok":true}"#.utf8))
    }

    private func account(_ email: String, _ transport: StubTransport) throws -> PushAccount {
        try #require(
            PushAccount(
                client: try APIFixtures.client(session: APIFixtures.session(email: email), transport: transport)))
    }

    nonisolated private static func calls(_ transport: StubTransport) throws -> [String] {
        try transport.sent.map { request in
            let body = try APIFixtures.object(request.httpBody)
            let token = (body["token"] as? String).map { String($0.prefix(4)) } ?? "-"
            return "\(request.httpMethod ?? "") \(request.url?.path() ?? "") \(token)"
        }
    }

    @Test("whenRegistering_APIClient_ShouldSendTheNativeAPNsBody")
    func requestShape() async throws {
        let transport = StubTransport { Self.ok($0) }
        let client = try APIFixtures.client(transport: transport)
        try await client.registerPushDevice(Self.tokenA, environment: .sandbox)
        try await client.unregisterPushDevice(Self.tokenA)

        let post = try #require(transport.sent.first)
        #expect(post.httpMethod == "POST" && post.url?.path() == "/api/push/devices")
        #expect(post.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
        let body = try APIFixtures.object(post.httpBody)
        #expect(body["token"] as? String == Self.tokenA.hex)
        #expect(body["platform"] as? String == "ios")
        #expect(body["provider"] as? String == "apns")
        #expect(body["environment"] as? String == "sandbox")
        #expect(body.count == 4)

        let delete = try #require(transport.sent.last)
        #expect(delete.httpMethod == "DELETE")
        #expect(try APIFixtures.object(delete.httpBody) as? [String: String] == ["token": Self.tokenA.hex])
    }

    @Test("whenRegistering_PushDevice_ShouldMatchTheContractSchema")
    func contract() throws {
        let root = try JSONSerialization.jsonObject(with: Data(contentsOf: Self.openAPI)) as? [String: Any]
        let schemas = (root?["components"] as? [String: Any])?["schemas"] as? [String: Any]
        let device = try #require((schemas?["PushDevice"] as? [String: Any])?["properties"] as? [String: Any])
        #expect((device["provider"] as? [String: Any])?["enum"] as? [String] == ["expo", "apns"])
        #expect(
            Set((device["environment"] as? [String: Any])?["enum"] as? [String] ?? [])
                == Set(PushEnvironment.allCases.map(\.rawValue)))
        let pattern = try #require((device["token"] as? [String: Any])?["pattern"] as? String)
        #expect(Self.tokenA.hex.wholeMatch(of: try Regex(pattern)) != nil)
    }

    nonisolated private static var openAPI: URL {
        var url = URL(filePath: #filePath)
        while url.path() != "/", !FileManager.default.fileExists(atPath: url.appending(path: "contracts").path()) {
            url.deleteLastPathComponent()
        }
        return url.appending(path: "contracts/openapi.json")
    }

    @Test("whenAllowedWithATokenAndAnAccount_PushRegistrar_ShouldRegisterOncePerProcess")
    func registersOnce() async throws {
        let transport = StubTransport { Self.ok($0) }
        let registrar = PushRegistrar(environment: .production, store: store)
        let alex = try account("alex@example.test", transport)

        await registrar.accountChanged(alex)
        #expect(registrar.status == .inactive, "nothing before permission")
        await registrar.permissionChanged(.allowed)
        #expect(registrar.status == .waitingForToken)
        await registrar.tokenReceived(Self.tokenA)
        #expect(registrar.status == .registered)
        // APNs hands the same token over at every launch and activation: nothing is sent again.
        await registrar.tokenReceived(Self.tokenA)
        await registrar.permissionChanged(.allowed)
        #expect(try Self.calls(transport) == ["POST /api/push/devices a1a1"])
        #expect(store.load() == StoredPushRegistration(token: Self.tokenA, environment: .production, owner: alex.owner))
        #expect(registrar.owner == alex.owner)
    }

    @Test("whenTheTokenIsRefreshed_PushRegistrar_ShouldRegisterTheNewOneAndRemoveTheOld")
    func refresh() async throws {
        let transport = StubTransport { Self.ok($0) }
        let registrar = PushRegistrar(environment: .sandbox, store: store)
        await registrar.permissionChanged(.allowed)
        await registrar.accountChanged(try account("alex@example.test", transport))
        await registrar.tokenReceived(Self.tokenA)
        await registrar.tokenReceived(Self.tokenB)
        #expect(
            try Self.calls(transport) == [
                "POST /api/push/devices a1a1", "POST /api/push/devices b2b2", "DELETE /api/push/devices a1a1",
            ])
        #expect(store.load()?.token == Self.tokenB)
    }

    @Test("whenTheAccountChanges_PushRegistrar_ShouldMoveTheTokenToTheNewAccount")
    func accountChange() async throws {
        let transport = StubTransport { Self.ok($0) }
        let registrar = PushRegistrar(environment: .sandbox, store: store)
        let alex = try account("alex@example.test", transport)
        let bea = try account("bea@example.test", transport)
        await registrar.permissionChanged(.allowed)
        await registrar.tokenReceived(Self.tokenA)
        await registrar.accountChanged(alex)
        await registrar.accountChanged(nil)
        #expect(registrar.status == .inactive)
        await registrar.accountChanged(bea)
        // Registering again moves the token to Bea's session on the server; Alex's token is not
        // deleted with Bea's session (it would be refused anyway).
        #expect(try Self.calls(transport) == ["POST /api/push/devices a1a1", "POST /api/push/devices a1a1"])
        #expect(store.load()?.owner == bea.owner)
        #expect(alex.owner != bea.owner)
    }

    @Test("whenNotificationsAreTurnedOff_PushRegistrar_ShouldRemoveTheRegistration")
    func denial() async throws {
        let transport = StubTransport { Self.ok($0) }
        let registrar = PushRegistrar(environment: .sandbox, store: store)
        await registrar.permissionChanged(.allowed)
        await registrar.accountChanged(try account("alex@example.test", transport))
        await registrar.tokenReceived(Self.tokenA)
        await registrar.permissionChanged(.denied)
        #expect(registrar.status == .inactive)
        #expect(try Self.calls(transport) == ["POST /api/push/devices a1a1", "DELETE /api/push/devices a1a1"])
        #expect(store.load() == nil)
        // Turned on again in iOS Settings: registered again.
        await registrar.permissionChanged(.allowed)
        #expect(registrar.status == .registered)
        #expect(try Self.calls(transport).count == 3)
    }

    @Test("whenTheServerFails_PushRegistrar_ShouldSayItAndRetryWhenActive")
    func failure() async throws {
        let answers = Mutex([503, 400, 201])
        let transport = StubTransport { request in
            let status = answers.withLock { $0.removeFirst() }
            return HTTPResult(
                status: status, headers: [:],
                body: Data((status == 201 ? #"{"ok":true}"# : #"{"error":"Invalid push device."}"#).utf8))
        }
        let registrar = PushRegistrar(environment: .sandbox, store: store)
        await registrar.permissionChanged(.allowed)
        await registrar.accountChanged(try account("alex@example.test", transport))
        await registrar.tokenReceived(Self.tokenA)
        #expect(registrar.status == .failed(retryable: true))
        #expect(store.load() == nil)
        await registrar.retry()
        #expect(registrar.status == .failed(retryable: false), "a Node server refuses APNs bodies")
        await registrar.retry()
        #expect(registrar.status == .registered)
        await registrar.retry()
        #expect(transport.sent.count == 3, "retry only retries a failure")
    }

    @Test("whenAPNsGivesNoToken_PushRegistrar_ShouldBeUnavailableWithoutBreakingAnything")
    func unavailable() async throws {
        let transport = StubTransport { Self.ok($0) }
        let registrar = PushRegistrar(environment: .sandbox, store: store)
        await registrar.permissionChanged(.allowed)
        await registrar.accountChanged(try account("alex@example.test", transport))
        registrar.tokenFailed()
        #expect(registrar.status == .unavailable)
        #expect(transport.sent.isEmpty)
        await registrar.tokenReceived(Self.tokenA)
        #expect(registrar.status == .registered)
    }

    @Test("whenTheAccountChangesDuringARegistration_PushRegistrar_ShouldDropTheEarlierAnswer")
    func staleAnswer() async throws {
        let gate = FirstRequestGate()
        let transport = StubTransport { request in
            if request.value(forHTTPHeaderField: "Authorization") != nil, gate.isFirst() { await gate.wait() }
            return Self.ok(request)
        }
        let registrar = PushRegistrar(environment: .sandbox, store: store)
        let alex = try account("alex@example.test", transport)
        let bea = try account("bea@example.test", transport)
        await registrar.permissionChanged(.allowed)
        await registrar.tokenReceived(Self.tokenA)
        let first = Task { await registrar.accountChanged(alex) }
        await gate.reached()
        await registrar.accountChanged(bea)
        gate.open()
        await first.value
        #expect(store.load()?.owner == bea.owner, "Alex's late answer never claims the registration")
        #expect(registrar.status == .registered)
    }

    @Test("whenSigningOut_APNsDeviceRegistration_ShouldRemoveOnlyThisAccountsToken")
    func signOut() async throws {
        let transport = StubTransport { Self.ok($0) }
        let alex = try account("alex@example.test", transport)
        let devices = APNsDeviceRegistration(store: store)
        await devices.unregister(using: alex.client)
        #expect(transport.sent.isEmpty, "nothing registered, nothing sent")

        store.save(StoredPushRegistration(token: Self.tokenA, environment: .sandbox, owner: alex.owner))
        await devices.unregister(using: try account("bea@example.test", transport).client)
        #expect(transport.sent.isEmpty, "another account's registration is left alone")
        #expect(store.load() != nil)

        await devices.unregister(using: alex.client)
        #expect(try Self.calls(transport) == ["DELETE /api/push/devices a1a1"])
        #expect(store.load() == nil)
    }

    @Test("whenTheServerCantBeReachedAtSignOut_APNsDeviceRegistration_ShouldNotThrowAndForgetTheToken")
    func signOutOffline() async throws {
        let transport = StubTransport { _ in throw URLError(.notConnectedToInternet) }
        let alex = try account("alex@example.test", transport)
        store.save(StoredPushRegistration(token: Self.tokenA, environment: .sandbox, owner: alex.owner))
        await APNsDeviceRegistration(store: store).unregister(using: alex.client)
        #expect(store.load() == nil, "server logout (or its expiry) removes the device on the server")
    }

    @Test("whenOwnersAreCompared_PushOwner_ShouldIgnoreEmailCaseAndHideTheEmail")
    func owner() throws {
        let server = APIFixtures.server
        let one = PushOwner(AccountScope(server: server, email: "Alex@Example.test"))
        #expect(one == PushOwner(AccountScope(server: server, email: "alex@example.test")))
        #expect(one != PushOwner(AccountScope(server: APIFixtures.otherServer, email: "alex@example.test")))
        #expect(!one.digest.contains("alex") && one.digest.count == 64)
    }

    @Test("whenTheStoredValueIsDamaged_PushRegistrationStore_ShouldReadNone")
    func damaged() throws {
        let suite = "penny.tests.push.\(UUID().uuidString)"
        UserDefaults(suiteName: suite)?.set(Data("{\"token\":\"zz\"}".utf8), forKey: "penny.push.registration")
        #expect(PushRegistrationStore(suiteName: suite).load() == nil)
    }

    @Test("whenReadingTheProvisioningProfile_PushEnvironment_ShouldFollowItsAPSEnvironment")
    func environment() {
        func profile(_ value: String?) -> Data {
            let entitlement = value.map { "<key>aps-environment</key><string>\($0)</string>" } ?? ""
            return Data(
                ("\u{30}\u{82}signed-header<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>"
                    + "<key>Entitlements</key><dict>\(entitlement)</dict></dict></plist>\u{0}trailer").utf8)
        }
        #expect(PushEnvironment.from(provisioningProfile: profile("development")) == .sandbox)
        #expect(PushEnvironment.from(provisioningProfile: profile("production")) == .production)
        #expect(PushEnvironment.from(provisioningProfile: profile(nil)) == .production)
        #expect(PushEnvironment.from(provisioningProfile: Data("garbage".utf8)) == .production)
        #expect(PushEnvironment.from(provisioningProfile: nil) == .production, "App Store installs have none")
    }
}

/// Holds the first request until the test opens it.
private final class FirstRequestGate: Sendable {
    private let state = Mutex<(first: Bool, open: Bool, waiters: [CheckedContinuation<Void, Never>], arrived: Bool)>(
        (true, false, [], false))

    func isFirst() -> Bool {
        state.withLock { value in
            defer { value.first = false }
            return value.first
        }
    }

    func wait() async {
        await withCheckedContinuation { continuation in
            let resume = state.withLock { value -> Bool in
                value.arrived = true
                if value.open { return true }
                value.waiters.append(continuation)
                return false
            }
            if resume { continuation.resume() }
        }
    }

    /// Waits until the held request arrived.
    func reached() async {
        while !state.withLock({ $0.arrived }) { await Task.yield() }
    }

    func open() {
        let waiters = state.withLock { value in
            value.open = true
            defer { value.waiters = [] }
            return value.waiters
        }
        for waiter in waiters { waiter.resume() }
    }
}
