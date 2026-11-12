import CryptoKit
public import Foundation
public import Observation
public import PennyDomain
import Security

/// Which account a push registration belongs to, without storing who it is: an HMAC-SHA256 of
/// the normalized server and lower-cased email, keyed with a random key kept in this device's
/// Keychain (`PushOwnerKeychain`). Kept with the stored registration so a notification left from
/// one account is never opened in another (docs/ios-notifications.md). Without the key, the
/// digest in `UserDefaults` (and in backups) cannot be matched to an email.
public struct PushOwner: Hashable, Sendable, Codable {
    public let digest: String

    init(_ scope: AccountScope, key: SymmetricKey) {
        digest = Self.hex(HMAC<SHA256>.authenticationCode(for: Data(Self.text(scope).utf8), using: key))
    }

    /// The unkeyed SHA-256 that development builds stored before the key existed. Only compared,
    /// to adopt such a registration for its account (`adoptLegacyRegistration`).
    static func legacy(_ scope: AccountScope) -> PushOwner {
        PushOwner(digest: hex(SHA256.hash(data: Data(text(scope).utf8))))
    }

    private init(digest: String) {
        self.digest = digest
    }

    private static func text(_ scope: AccountScope) -> String {
        "\(scope.server.description) \(scope.email.lowercased())"
    }

    private static func hex(_ bytes: some Sequence<UInt8>) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }
}

/// The key `PushOwner` digests are made with: 32 random bytes, created on first use and kept as
/// one generic-password item (service `com.mfalicoff.penny.push-owner`) in the data protection
/// keychain, readable after the first unlock, on this device only (never synced, never restored
/// onto another device). A restored or new device makes a new key, so a registration stored
/// elsewhere matches no account until the next registration replaces it.
struct PushOwnerKeychain: Sendable {
    static let service = "\(AppIdentity.bundleIdentifier).push-owner"
    let backend: any KeychainBackend

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: "owner-key",
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// The key, created when there is none. Nil while the Keychain cannot be used (before the
    /// first unlock): nothing registers or opens until it can.
    func key() -> SymmetricKey? {
        if let existing = read() { return existing }
        let key = SymmetricKey(size: .bits256)
        var item = query
        item[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        item[kSecAttrSynchronizable as String] = false
        item[kSecAttrLabel as String] = "Penny notifications"
        switch backend.add(item) {
        case errSecSuccess: return key
        case errSecDuplicateItem: return read()  // made meanwhile
        default: return nil
        }
    }

    private func read() -> SymmetricKey? {
        var read = query
        read[kSecReturnData as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, data) = backend.copyData(read)
        guard status == errSecSuccess, let data, data.count == 32 else { return nil }
        return SymmetricKey(data: data)
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
/// named suite in tests, with the owner key in the Keychain. A damaged value reads as none.
public struct PushRegistrationStore: Sendable {
    static let key = "penny.push.registration"
    private let suiteName: String?
    private let keychain: PushOwnerKeychain

    public init(suiteName: String? = nil, keychain: any KeychainBackend = SystemKeychain()) {
        self.suiteName = suiteName
        self.keychain = PushOwnerKeychain(backend: keychain)
    }

    private var defaults: UserDefaults { suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard }

    public func load() -> StoredPushRegistration? {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(StoredPushRegistration.self, from: $0) }
    }

    /// Saves the registration and makes its owner the device's `lastOwner`.
    public func save(_ registration: StoredPushRegistration) {
        guard let data = try? JSONEncoder().encode(registration),
            let owner = try? JSONEncoder().encode(registration.owner)
        else { return }
        defaults.set(data, forKey: Self.key)
        defaults.set(owner, forKey: Self.ownerKey)
    }

    /// Forgets the registration (the server removed the device). `lastOwner` stays.
    public func clear() { defaults.removeObject(forKey: Self.key) }

    static let ownerKey = "penny.push.lastOwner"

    /// The account this device's token was last registered for (`penny.push.lastOwner`), kept
    /// after the registration is removed until another account registers: notifications
    /// delivered before the removal may still be on screen. Nil only when this install never
    /// registered, so no APNs notification can have reached it.
    public func lastOwner() -> PushOwner? {
        defaults.data(forKey: Self.ownerKey).flatMap { try? JSONDecoder().decode(PushOwner.self, from: $0) }
            ?? load()?.owner
    }

    /// The owner digest for `scope` on this device. Nil while the Keychain cannot be read.
    public func owner(for scope: AccountScope) -> PushOwner? {
        keychain.key().map { PushOwner(scope, key: $0) }
    }

    /// A registration stored by a development build before owner digests were keyed belongs to
    /// `account` when its unkeyed digest is the account's: it is rewritten with the keyed one,
    /// so the upgrade neither clears that account's notifications nor drops a tap on one.
    public func adoptLegacyRegistration(for account: PushAccount) {
        guard defaults.data(forKey: Self.ownerKey) == nil, var stored = load(), let scope = account.client.scope,
            stored.owner == PushOwner.legacy(scope)
        else { return }
        stored.owner = account.owner
        save(stored)
    }
}

/// Sign-out's half of the registration (`DeviceRegistration`): while the session still works,
/// `DELETE /api/push/devices` for the token this account registered. The stored registration
/// is forgotten only once the server says the device is gone (or the session already ended
/// there). After a failed request it stays: its owner keeps this account's notifications from
/// showing or opening in the next account until that account registers the token. Never
/// throws: server logout drops the session's devices anyway.
public struct APNsDeviceRegistration: DeviceRegistration {
    let store: PushRegistrationStore
    /// Sign-out did not go ahead (`signOutCancelled`): registers the device again if needed.
    let resume: @Sendable () async -> Void

    public init(
        store: PushRegistrationStore = PushRegistrationStore(), resume: @escaping @Sendable () async -> Void = {}
    ) {
        self.store = store
        self.resume = resume
    }

    public func unregister(using client: APIClient) async {
        guard let stored = store.load() else { return }
        guard let scope = client.scope, stored.owner == store.owner(for: scope) else { return }
        do {
            try await client.unregisterPushDevice(stored.token)
        } catch let error as APIError where error.meansDeviceIsGone {
            // The session or the device is already gone on the server.
        } catch {
            return
        }
        if store.load() == stored { store.clear() }
    }

    public func signOutCancelled(using client: APIClient) async {
        await resume()
    }
}

extension APIError {
    /// The server no longer sends to this device for the session: it ended, or the device is
    /// not registered.
    fileprivate var meansDeviceIsGone: Bool {
        if requiresSignIn { return true }
        if case .notFound = self { return true }
        return false
    }
}

/// The signed-in account a registration is for.
public struct PushAccount: Sendable {
    public let client: APIClient
    public let owner: PushOwner

    /// Nil when the client has no session, or the owner key cannot be read now.
    public init?(client: APIClient, store: PushRegistrationStore) {
        guard let scope = client.scope, let owner = store.owner(for: scope) else { return nil }
        self.client = client
        self.owner = owner
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

    /// The account this device's token was last registered for (`PushRegistrationStore.lastOwner`),
    /// also after sign-out or a denial removed the registration; nil only before this install's
    /// first registration.
    public var owner: PushOwner? { store.lastOwner() }

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

    /// Checks the registration again after something else may have removed it: a sign-out that
    /// removed the device and then did not go ahead.
    public func resync() async {
        await sync()
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
        // Trusted only while the stored registration still says so: sign-out may have removed
        // the device and then not gone ahead, leaving the same account signed in.
        if let registered, registered.token == token, registered.owner == account.owner,
            let stored = store.load(), stored.token == token, stored.owner == account.owner
        {
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
