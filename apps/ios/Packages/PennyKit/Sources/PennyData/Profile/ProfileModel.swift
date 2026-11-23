public import Foundation
public import Observation

/// What the profile screens ask the server (MAZ-171). A protocol so the model is tested without
/// a network; the app uses `APIProfileService`.
public protocol ProfileService: Sendable {
    func me() async throws -> WireMe
    func profile() async throws -> WireProfile
    func updateProfile(_ update: WireProfileUpdate) async throws -> WireProfile
    func uploadAvatar(_ data: Data) async throws -> WireProfile
    func removeAvatar() async throws -> WireProfile
    func changePassword(_ change: WirePasswordChange) async throws
    func avatar(_ path: String) async throws -> Data
}

/// The signed-in account's profile, straight from the API. A 401 ends the session it was made
/// with, as everywhere else.
public struct APIProfileService: ProfileService {
    private let client: APIClient
    private let sessionExpired: (@MainActor @Sendable () -> Void)?

    public init(client: APIClient, sessionExpired: (@MainActor @Sendable () -> Void)? = nil) {
        self.client = client
        self.sessionExpired = sessionExpired
    }

    private func call<Value>(_ request: () async throws -> Value) async throws -> Value {
        try await SessionExpiry.run(sessionExpired, request)
    }

    public func me() async throws -> WireMe { try await call { try await client.me() } }
    public func profile() async throws -> WireProfile { try await call { try await client.profile() } }
    public func updateProfile(_ update: WireProfileUpdate) async throws -> WireProfile {
        try await call { try await client.updateProfile(update) }
    }
    public func uploadAvatar(_ data: Data) async throws -> WireProfile {
        try await call { try await client.uploadAvatar(data) }
    }
    public func removeAvatar() async throws -> WireProfile { try await call { try await client.removeAvatar() } }
    public func changePassword(_ change: WirePasswordChange) async throws {
        try await call { try await client.changePassword(change) }
    }
    public func avatar(_ path: String) async throws -> Data { try await call { try await client.avatar(path) } }
}

/// How a password change ended (`POST /api/auth/password`).
public enum PasswordChangeOutcome: Equatable, Sendable {
    /// This device stays signed in; the others need the new password.
    case changed
    /// "Your current password is incorrect.": clear and refocus Current password.
    case wrongCurrentPassword(String)
    /// The new password breaks the rule (or another 400).
    case invalidNewPassword(String)
    /// The account signs in with a provider and has no password.
    case notAllowed(String)
    case failed(String)
}

/// The signed-in person's name and picture (MAZ-171): the Settings account row, the iPad
/// sidebar, the name prompt and Settings › Profile. Nil service (the demo, previews) shows nothing.
@MainActor
@Observable
public final class ProfileModel {
    public enum Load: Equatable, Sendable {
        case idle, loading, loaded
        case failed(String)
    }

    /// The full profile, read by Settings › Profile.
    public private(set) var profile: WireProfile?
    public private(set) var load: Load = .idle
    /// The person's name, else nil (show the email).
    public private(set) var displayName: String?
    public private(set) var avatarUrl: String?
    /// The server asks for a name ("What should people call you?"). False on older servers.
    public private(set) var needsName = false
    /// The prompt was shown, saved or skipped on this launch, so it never comes back before the
    /// server agrees.
    public private(set) var promptHandled = false

    @ObservationIgnored public let service: (any ProfileService)?

    public init(service: (any ProfileService)?) {
        self.service = service
    }

    public var isAvailable: Bool { service != nil }

    /// Whether to show the name prompt now.
    public var showsNamePrompt: Bool { needsName && !promptHandled }

    /// `GET /api/auth/me`: the name, picture and whether to ask for a name. A failure keeps what
    /// is shown.
    public func refreshSummary() async {
        guard let service, let me = try? await service.me() else { return }
        displayName = Self.cleaned(me.displayName)
        avatarUrl = me.avatarUrl
        needsName = me.needsName ?? false
    }

    /// `GET /api/profile`, for Settings › Profile.
    public func refresh() async {
        guard let service else { return }
        if profile == nil { load = .loading }
        do {
            apply(try await service.profile())
            load = .loaded
        } catch is CancellationError {
            if profile == nil { load = .idle }
        } catch {
            if profile == nil { load = .failed(Self.message(error, fallback: "Penny couldn't load your profile.")) }
        }
    }

    /// Saves the name. Returns the message to show when it wasn't saved. A blank name clears it.
    public func saveName(_ text: String) async -> String? {
        guard let service else { return "Your name wasn't saved. Try again." }
        let update: WireProfileUpdate
        switch DisplayName.validate(text) {
        case .valid(let name): update = WireProfileUpdate(displayName: name)
        case .empty: update = .clearingName()
        case .invalid(let message): return message
        }
        do {
            apply(try await service.updateProfile(update))
            promptHandled = true
            return nil
        } catch {
            return Self.message(error, fallback: "Your name wasn't saved. Try again.")
        }
    }

    /// "Not now" on the name prompt: the server stops asking. The prompt goes away even when the
    /// request fails; it may come back on a later launch.
    public func dismissNamePrompt() async {
        promptHandled = true
        guard let service, let profile = try? await service.updateProfile(WireProfileUpdate(namePromptDismissed: true))
        else { return }
        apply(profile)
    }

    /// The prompt was shown; it isn't shown again on this launch.
    public func markPromptShown() { promptHandled = true }

    public func uploadPicture(_ data: Data) async -> String? {
        guard let service else { return "The picture wasn't saved. Try again." }
        do {
            apply(try await service.uploadAvatar(data))
            return nil
        } catch {
            return Self.message(error, fallback: "The picture wasn't saved. Try again.")
        }
    }

    public func removePicture() async -> String? {
        guard let service else { return "The picture wasn't removed. Try again." }
        do {
            apply(try await service.removeAvatar())
            return nil
        } catch {
            return Self.message(error, fallback: "The picture wasn't removed. Try again.")
        }
    }

    public func changePassword(current: String, new: String) async -> PasswordChangeOutcome {
        guard let service else { return .failed("Your password wasn't changed. Try again.") }
        guard !current.isEmpty else { return .wrongCurrentPassword("Enter your current password.") }
        guard (PasswordRules.minLength...PasswordRules.maxLength).contains(new.utf16.count) else {
            return .invalidNewPassword(PasswordRules.lengthMessage)
        }
        do {
            try await service.changePassword(WirePasswordChange(currentPassword: current, newPassword: new))
            await refresh()
            return .changed
        } catch let error as APIError {
            switch error {
            case .badRequest(let message):
                if message == PasswordRules.wrongCurrent { return .wrongCurrentPassword(PasswordRules.wrongCurrent) }
                return .invalidNewPassword(message ?? PasswordRules.lengthMessage)
            case .forbidden:
                return .notAllowed("Your account signs in with a provider, so it has no password to change.")
            default:
                return .failed(Self.message(error, fallback: "Your password wasn't changed. Try again."))
            }
        } catch {
            return .failed("Your password wasn't changed. Try again.")
        }
    }

    private func apply(_ profile: WireProfile) {
        self.profile = profile
        displayName = Self.cleaned(profile.displayName)
        avatarUrl = profile.avatarUrl
        needsName = profile.needsName
    }

    private static func cleaned(_ name: String?) -> String? {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    /// What the profile screens say when the server didn't do what was asked.
    public static func message(_ error: any Error, fallback: String) -> String {
        guard let error = error as? APIError else { return fallback }
        switch error {
        case .offline, .timeout, .unreachable: return "Penny can't reach the server. Try again when you're online."
        case .rateLimited(let after):
            let minutes = after.map { max(1, Int(($0 / 60).rounded(.up))) } ?? 15
            return "Too many attempts. Please try again in \(minutes) minute\(minutes == 1 ? "" : "s")."
        case .payloadTooLarge: return "This picture is too large. Choose one under 10 MB."
        case .forbidden(let message): return message ?? "Your sign-in provider manages this."
        case .badRequest(let message): return message ?? fallback
        case .unauthorized: return "Your session ended. Sign in again."
        default: return fallback
        }
    }
}

/// The password rule the API applies to new passwords (sign-up and Change password).
public enum PasswordRules {
    public static let minLength = 10
    public static let maxLength = 256
    public static let lengthMessage = "Use a new password of 10 to 256 characters."
    /// The API's message for a wrong current password (a 400, so the session survives it).
    public static let wrongCurrent = "Your current password is incorrect."
}

/// Downloaded pictures by URL (MAZ-171). An `avatarUrl` carries the picture's version, so a URL's
/// bytes never change and are kept for the session. A 404 means no picture (or one the viewer may
/// not see) and is remembered too, so the monogram stays without asking again.
@MainActor
@Observable
public final class AvatarStore {
    public enum Entry: Equatable, Sendable {
        case loading
        case loaded(Data)
        case missing
    }

    public private(set) var entries: [String: Entry] = [:]
    @ObservationIgnored private let fetch: (@Sendable (String) async throws -> Data)?
    @ObservationIgnored private let limit: Int

    public init(fetch: (@Sendable (String) async throws -> Data)?, limit: Int = 200) {
        self.fetch = fetch
        self.limit = limit
    }

    public convenience init(service: (any ProfileService)?) {
        guard let service else {
            self.init(fetch: nil)
            return
        }
        let fetch: @Sendable (String) async throws -> Data = { path in try await service.avatar(path) }
        self.init(fetch: fetch)
    }

    /// The picture's bytes when loaded.
    public func data(_ url: String?) -> Data? {
        guard let url, case .loaded(let data) = entries[url] else { return nil }
        return data
    }

    /// Loads `url` once. A failure other than 404 (offline) is forgotten, so it is tried again later.
    public func load(_ url: String) async {
        guard let fetch, entries[url] == nil else { return }
        if entries.count >= limit { entries = entries.filter { _, entry in entry == Entry.loading } }
        entries[url] = .loading
        do {
            entries[url] = .loaded(try await fetch(url))
        } catch let error as APIError {
            if case .notFound = error { entries[url] = .missing } else { entries[url] = nil }
        } catch {
            entries[url] = nil
        }
    }
}
