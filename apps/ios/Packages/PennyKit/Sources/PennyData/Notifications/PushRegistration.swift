import CryptoKit
public import Foundation
public import Observation
public import PennyDomain

/// Which account a push registration belongs to, without storing who it is: a SHA-256 of the
/// normalized server and lower-cased email. Kept with the stored registration so a notification
/// left from one account is never opened in another (docs/ios-notifications.md).
public struct PushOwner: Hashable, Sendable, Codable {
    public let digest: String

    public init(_ scope: AccountScope) {
        let key = "\(scope.server.description) \(scope.email.lowercased())"
        digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// What the person allowed in iOS Settings, reduced to what Penny needs. Provisional and
/// ephemeral authorization count as allowed: notifications are delivered.
public enum PushPermission: Equatable, Sendable {
    case notDetermined
    case denied
    case allowed
}

/// The last registration the server accepted, kept on this device (`UserDefaults`, this
/// device only): the token to remove at sign-out and the account it belongs to.
public struct StoredPushRegistration: Equatable, Sendable, Codable {
    public var token: PushDeviceToken
    public var environment: PushEnvironment
    public var owner: PushOwner

    public init(token: PushDeviceToken, environment: PushEnvironment, owner: PushOwner) {
        self.token = token
        self.environment = environment
        self.owner = owner
    }

    private enum CodingKeys: String, CodingKey { case token, environment, owner }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let token = PushDeviceToken(hex: try container.decode(String.self, forKey: .token)),
            let environment = PushEnvironment(rawValue: try container.decode(String.self, forKey: .environment))
        else { throw DecodingError.dataCorruptedError(forKey: .token, in: container, debugDescription: "invalid") }
        self.token = token
        self.environment = environment
        owner = try container.decode(PushOwner.self, forKey: .owner)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(token.hex, forKey: .token)
        try container.encode(environment.rawValue, forKey: .environment)
        try container.encode(owner, forKey: .owner)
    }
}

/// Where the registration is kept: `UserDefaults.standard` (`penny.push.registration`), or a
/// named suite in tests. A damaged value reads as none.
public struct PushRegistrationStore: Sendable {
    static let key = "penny.push.registration"
    private let suiteName: String?

    public init(suiteName: String? = nil) {
        self.suiteName = suiteName
    }

    private var defaults: UserDefaults { suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard }

    public func load() -> StoredPushRegistration? {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(StoredPushRegistration.self, from: $0) }
    }

    public func save(_ registration: StoredPushRegistration) {
        if let data = try? JSONEncoder().encode(registration) { defaults.set(data, forKey: Self.key) }
    }

    public func clear() { defaults.removeObject(forKey: Self.key) }
}

/// Sign-out's half of the registration (`DeviceRegistration`): while the session still works,
/// `DELETE /api/push/devices` for the token this account registered, then forget it. Never
/// throws: server logout drops the session's devices anyway.
public struct APNsDeviceRegistration: DeviceRegistration {
    let store: PushRegistrationStore

    public init(store: PushRegistrationStore = PushRegistrationStore()) {
        self.store = store
    }

    public func unregister(using client: APIClient) async {
        guard let stored = store.load() else { return }
        guard let scope = client.scope, stored.owner == PushOwner(scope) else { return }
        try? await client.unregisterPushDevice(stored.token)
        store.clear()
    }
}

/// The signed-in account a registration is for.
public struct PushAccount: Sendable {
    public let client: APIClient
    public let owner: PushOwner

    /// Nil when the client has no session.
    public init?(client: APIClient) {
        guard let scope = client.scope else { return nil }
        self.client = client
        owner = PushOwner(scope)
    }
}

/// Where the push registration stands, for Settings.
public enum PushRegistrationStatus: Equatable, Sendable {
    /// Nothing to register: signed out, the demo, or notifications not allowed.
    case inactive
    /// Allowed, waiting for APNs to hand over a token.
    case waitingForToken
    case registering
    case registered
    /// APNs gave no token (no network at first launch, a simulator without push, a build
    /// without the entitlement). Penny works without it; it asks again at the next launch.
    case unavailable
    /// The server refused or could not be reached. Tried again when Penny becomes active.
    case failed(retryable: Bool)
}

/// The APNs registration lifecycle (MAZ-79), independent of UIKit so it is tested on the
/// host. The app feeds it the permission, the token APNs hands over (again at every launch, and
/// whenever it changes) and the signed-in account; it registers the token for that account's
/// session once per process and token, re-registers after a token refresh or an account change
/// (which moves the token to the new session on the server), and removes the registration when
/// the person turns notifications off. Answers for an earlier account are dropped.
@MainActor
@Observable
public final class PushRegistrar {
    public private(set) var status: PushRegistrationStatus = .inactive
    public private(set) var permission: PushPermission = .notDetermined

    @ObservationIgnored public let environment: PushEnvironment
    @ObservationIgnored private let store: PushRegistrationStore
    @ObservationIgnored private var token: PushDeviceToken?
    @ObservationIgnored private var tokenFailed = false
    @ObservationIgnored private var account: PushAccount?
    /// What this process registered, so a repeated token or activation sends nothing.
    @ObservationIgnored private var registered: (token: PushDeviceToken, owner: PushOwner)?
    @ObservationIgnored private var generation = 0

    public init(environment: PushEnvironment, store: PushRegistrationStore = PushRegistrationStore()) {
        self.environment = environment
        self.store = store
    }

    /// The account the stored registration belongs to; nil before the first registration and
    /// after sign-out.
    public var owner: PushOwner? { store.load()?.owner }

    public func permissionChanged(_ next: PushPermission) async {
        permission = next
        await sync()
    }

    public func accountChanged(_ next: PushAccount?) async {
        if next?.owner != account?.owner { registered = nil }
        account = next
        generation += 1
        await sync()
    }

    public func tokenReceived(_ next: PushDeviceToken) async {
        tokenFailed = false
        token = next
        await sync()
    }

    public func tokenFailed(_ failed: Bool = true) {
        tokenFailed = failed
        if failed, token == nil, permission == .allowed, account != nil { status = .unavailable }
    }

    /// Tries a failed registration again (Penny became active).
    public func retry() async {
        if case .failed = status { await sync() }
    }

    private func sync() async {
        guard let account else {
            status = .inactive
            return
        }
        guard permission == .allowed else {
            status = .inactive
            if permission == .denied { await remove(for: account) }
            return
        }
        guard let token else {
            status = tokenFailed ? .unavailable : .waitingForToken
            return
        }
        if let registered, registered.token == token, registered.owner == account.owner {
            status = .registered
            return
        }
        generation += 1
        let attempt = generation
        status = .registering
        let previous = store.load()
        do {
            try await account.client.registerPushDevice(token, environment: environment)
        } catch is CancellationError {
            if attempt == generation { status = .failed(retryable: true) }
            return
        } catch {
            guard attempt == generation else { return }
            status = .failed(retryable: (error as? APIError)?.isRetryable ?? true)
            return
        }
        guard attempt == generation else { return }
        registered = (token, account.owner)
        store.save(StoredPushRegistration(token: token, environment: environment, owner: account.owner))
        status = .registered
        // A refreshed token replaces the old one for this account; the old one is useless.
        if let previous, previous.owner == account.owner, previous.token != token {
            try? await account.client.unregisterPushDevice(previous.token)
        }
    }

    /// Notifications were turned off: stop the server sending to this device.
    private func remove(for account: PushAccount) async {
        registered = nil
        guard let stored = store.load(), stored.owner == account.owner else { return }
        let attempt = generation
        do {
            try await account.client.unregisterPushDevice(stored.token)
        } catch {
            return
        }
        if attempt == generation, store.load() == stored { store.clear() }
    }
}

extension PushEnvironment {
    /// The gateway this build's signature uses. Simulators use the sandbox. A device build reads
    /// `aps-environment` from its embedded provisioning profile (`development` for Xcode builds);
    /// App Store and TestFlight installs carry no profile and use production.
    public static func current(bundle: Bundle = .main) -> PushEnvironment {
        #if targetEnvironment(simulator)
            return .sandbox
        #else
            let profile = bundle.url(forResource: "embedded", withExtension: "mobileprovision")
                .flatMap { try? Data(contentsOf: $0) }
            return from(provisioningProfile: profile)
        #endif
    }

    /// `aps-environment` from a provisioning profile (a CMS-signed property list). No profile, or
    /// none that says `development`, means production.
    public static func from(provisioningProfile data: Data?) -> PushEnvironment {
        guard let data, let start = data.range(of: Data("<?xml".utf8)),
            let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
            let plist = try? PropertyListSerialization.propertyList(
                from: data[start.lowerBound..<end.upperBound], format: nil) as? [String: Any],
            let entitlements = plist["Entitlements"] as? [String: Any]
        else { return .production }
        return entitlements["aps-environment"] as? String == "development" ? .sandbox : .production
    }
}
