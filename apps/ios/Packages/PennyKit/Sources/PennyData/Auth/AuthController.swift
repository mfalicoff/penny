public import Foundation
public import Observation
public import PennyDomain

/// The sign-in state machine (MAZ-68): restores the saved session at launch, signs in with a
/// password or single sign-on, registers, handles expiry and signs out, and keeps exactly one
/// session (per server) in the Keychain. It owns the choice of server while signed out.
///
/// Every answer that arrives after the state moved on (another sign-in, a sign-out, a server
/// change) is dropped, so one account's session or data never reaches another's screen.
/// See docs/ios-authentication.md.
@MainActor
@Observable
public final class AuthController {
    public private(set) var state: AuthState = .restoring
    /// The server sign-in uses. Nil only in Release before the person chooses one.
    public private(set) var server: SavedServer?
    public private(set) var singleSignOn: SingleSignOnStatus = .unknown
    /// An account whose entries are still on this device because removing them failed at
    /// sign-out. The signed-out screen says so and offers `removeUnremovedLocalData()`. Kept across
    /// launches (`AuthPreferences.unremovedLocalData`).
    public private(set) var unremovedLocalData: AccountScope?

    @ObservationIgnored private let defaultServer: ServerURL?
    @ObservationIgnored private let sessions: any SessionStore
    @ObservationIgnored private let preferences: any AuthPreferences
    @ObservationIgnored private let transport: any HTTPTransport
    @ObservationIgnored private let localData: any AccountLocalData
    @ObservationIgnored private let devices: any DeviceRegistration
    @ObservationIgnored private let now: @Sendable () -> Date
    /// Bumped by every transition that invalidates work in flight.
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var pendingSingleSignOn: PendingSingleSignOn?
    @ObservationIgnored private var replayGuard = CallbackReplayGuard()
    /// Moving local data after a launch-time email change; sign-out waits for it.
    @ObservationIgnored private var emailMigration: Task<Void, Never>?

    /// Timeout for checking a candidate server, as in the legacy app.
    static let probeTimeout: TimeInterval = 10

    public init(
        defaultServer: ServerURL?,
        sessions: any SessionStore = KeychainSessionStore(),
        preferences: any AuthPreferences = UserDefaultsAuthPreferences(),
        transport: any HTTPTransport = URLSessionTransport(),
        localData: any AccountLocalData = NoLocalAccountData(),
        devices: any DeviceRegistration = NoDeviceRegistration(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.defaultServer = defaultServer
        self.sessions = sessions
        self.preferences = preferences
        self.transport = transport
        self.localData = localData
        self.devices = devices
        self.now = now
        // A sign-out that could not remove its entries before the app quit still offers it.
        unremovedLocalData = preferences.unremovedLocalData()
    }

    private func setUnremovedLocalData(_ scope: AccountScope?) {
        unremovedLocalData = scope
        preferences.setUnremovedLocalData(scope)
    }

    /// A client for the signed-in account, or nil while signed out. Features use only this
    /// client, so a request always carries the current account's token to its own server.
    public var client: APIClient? {
        guard let account = state.account else { return nil }
        return try? APIClient(
            configuration: APIConfiguration(server: account.server), session: account.session, transport: transport)
    }

    // MARK: Launch

    /// Reads the saved server and session. A saved session signs in at once (unverified, so
    /// local data shows offline) and is then confirmed with `/api/auth/me`: a 401 ends it,
    /// a network failure keeps it. Call again from `.keychainUnavailable` after unlock.
    public func restore() async {
        guard state == .restoring || state == .keychainUnavailable else { return }
        state = .restoring
        var purged = true
        do { try purgeLeftoverSessionsIfNeeded() } catch .unavailable {
            state = .keychainUnavailable
            return
        } catch {
            // A leftover may be another person's session: restore nothing. The purge runs
            // again before the next session is saved and at the next launch.
            purged = false
        }
        server = preferences.savedServer() ?? defaultServer.map { SavedServer(server: $0) }
        guard let server, purged else {
            state = .signedOut(nil)
            return
        }
        let stored: ServerSession?
        do {
            stored = try sessions.load(server: server.server)
        } catch .unavailable {
            state = .keychainUnavailable
            return
        } catch {
            stored = nil
        }
        guard let stored else {
            state = .signedOut(nil)
            return
        }
        let account = activate(stored, verified: false)
        await verify(account)
    }

    private func verify(_ account: SignedInAccount) async {
        guard let client = try? signedInClient(account) else { return }
        let email: String
        do {
            email = try await client.me().email
        } catch let error as APIError where error.requiresSignIn {
            // Ignored unless `account` is still the current session (not a newer sign-in,
            // not a sign-out in progress).
            sessionDidExpire(for: account)
            return
        } catch {
            // Offline or a server problem: stay signed in with local data, unverified.
            return
        }
        guard case .signedIn = state, isCurrent(account) else { return }
        if email.lowercased() == account.email.lowercased() {
            var verified = account
            verified.isVerified = true
            state = .signedIn(verified)
            return
        }
        let migration = Task { await adoptChangedEmail(email, for: account) }
        emailMigration = migration
        await migration.value
        if emailMigration == migration { emailMigration = nil }
    }

    /// The token now belongs to another email (changed on the server). The token is the
    /// authority, so the account moves to that email's scope, and its local data moves with
    /// it first so unsynced work is neither orphaned nor shown under the old scope. If the
    /// data cannot move, nothing changes: the account stays on the stored scope, unverified,
    /// and the next launch tries again.
    private func adoptChangedEmail(_ email: String, for account: SignedInAccount) async {
        guard
            let session = try? ServerSession(
                server: account.server, email: email, token: account.session.tokenForStorage)
        else { return }
        do {
            try await localData.moveLocalData(from: account.scope, to: session.scope)
        } catch {
            return
        }
        // Sign-out and "Sync, then sign out" wait for this migration, so the account is
        // normally still current; if it expired meanwhile, its data already sits under the
        // new scope, which is where the next sign-in (with the new email) looks.
        guard case .signedIn = state, isCurrent(account) else { return }
        try? sessions.save(session)
        _ = activate(session, verified: true)
    }

    // MARK: Password

    /// `POST /api/auth/login`. On failure the state returns to signed out and the error
    /// says what to do; the screen keeps what the person typed.
    public func signIn(email: String, password: String) async throws(AuthFailure) {
        try await passwordSignIn(email: email, password: password, method: .password)
    }

    /// `POST /api/auth/register`, then signed in.
    public func register(email: String, password: String) async throws(AuthFailure) {
        try await passwordSignIn(email: email, password: password, method: .registration)
    }

    private func passwordSignIn(email: String, password: String, method: SignInMethod) async throws(AuthFailure) {
        let (server, previous) = try beginSignIn()
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !password.isEmpty else {
            throw AuthFailure(.invalidInput, "Enter your email and password.")
        }
        if method == .registration, !(10...256).contains(password.utf16.count) {
            throw AuthFailure(.invalidInput, "Use a password of 10–256 characters.")
        }
        state = .signingIn(method)
        let attempt = bump()
        let client = anonymousClient(server.server)
        let credentials = WireCredentials(email: trimmed, password: password)
        let session: ServerSession
        do {
            if method == .registration {
                session = try await client.register(credentials)
            } else {
                session = try await client.login(credentials)
            }
        } catch {
            if attempt == generation { state = .signedOut(previous) }
            throw Self.failure(error, during: method, server: server.server)
        }
        try await install(session, previous: previous)
    }

    // MARK: Single sign-on

    /// Reads `GET /api/auth/oidc` for the current server, for the sign-in screen.
    public func refreshSingleSignOn() async {
        guard let server else {
            singleSignOn = .unknown
            return
        }
        singleSignOn = .checking
        let status: SingleSignOnStatus
        do {
            let config = try await anonymousClient(server.server).oidcConfiguration()
            status = config.enabled ? .available(label: Self.label(config.label)) : .unavailable
        } catch APIError.notFound {
            status = .unavailable
        } catch {
            status = .failed
        }
        if self.server == server { singleSignOn = status }
    }

    /// Single sign-on with the system authentication session: start an attempt, open the
    /// provider, then redeem the callback once. Closing the sheet returns `.cancelled`.
    public func signInWithSingleSignOn(using authenticator: any WebAuthenticator) async throws(AuthFailure)
        -> SignInOutcome
    {
        let (server, previous) = try beginSignIn()
        guard pendingSingleSignOn == nil else { throw AuthFailure(.busy, "Single sign-on is already open.") }
        state = .signingIn(.singleSignOn)
        let attempt = bump()
        let client = anonymousClient(server.server)
        func reset() { if attempt == generation { state = .signedOut(previous) } }

        // The attempt is measured from when it was requested, on the device clock, for the
        // lifetime the server states on its own clock: a skewed device clock cancels out.
        let requestedAt = now()
        let challenge: WireOidcChallenge
        do {
            challenge = try await client.startOidc(redirectUri: SingleSignOnRedirect.uri)
        } catch {
            reset()
            throw Self.failure(error, during: .singleSignOn, server: server.server)
        }
        guard attempt == generation else { throw Self.superseded }
        guard let authorizationURL = challenge.authorizationURL else {
            // `startOidc` already refuses this; kept so the sheet can never open a non-HTTPS page.
            reset()
            throw Self.failure(APIError.malformedResponse, during: .singleSignOn, server: server.server)
        }
        let deadline = challenge.lifetime.map { requestedAt.addingTimeInterval($0) }
        guard deadline.map({ $0 > now() }) ?? true else {
            reset()
            throw AuthFailure(.singleSignOnExpired, "Sign-in expired. Please try again.")
        }
        let pending = PendingSingleSignOn(
            id: attempt, server: server.server, transaction: challenge.transaction, deadline: deadline)
        pendingSingleSignOn = pending

        let callback: URL
        do {
            callback = try await authenticator.authenticate(
                at: authorizationURL, callbackScheme: SingleSignOnRedirect.scheme)
        } catch {
            if pendingSingleSignOn == pending { pendingSingleSignOn = nil }
            reset()
            if error is CancellationError { return .cancelled }
            throw AuthFailure(.singleSignOnRejected, "Single sign-on couldn't open. Please try again.")
        }
        // Consume the attempt before anything else: whatever happens next, it is never used again.
        guard pendingSingleSignOn == pending, attempt == generation else { throw Self.superseded }
        pendingSingleSignOn = nil
        guard SingleSignOnRedirect.isWellFormed(callback), replayGuard.admit(callback) else {
            reset()
            throw AuthFailure(.callbackRejected, "This sign-in response was not accepted. Please try again.")
        }
        guard pending.deadline.map({ $0 > now() }) ?? true else {
            reset()
            throw AuthFailure(.singleSignOnExpired, "Sign-in expired. Please try again.")
        }
        let session: ServerSession
        do {
            session = try await client.completeOidc(transaction: pending.transaction, callbackURL: callback)
        } catch {
            reset()
            if SingleSignOnRedirect.isDeclined(callback), (error as? APIError)?.requiresSignIn == true {
                return .cancelled
            }
            throw Self.failure(error, during: .singleSignOn, server: server.server)
        }
        try await install(session, previous: previous)
        return .signedIn
    }

    // MARK: Expiry and sign-out

    /// Call when a request made for `account` answers 401: pass the `state.account` the
    /// request's client was made for. Only the current session's own 401 ends it. A late
    /// answer for an earlier session is ignored, even one of the same account and server
    /// (signed out and in again since), and so is one that arrives while signing out.
    /// Local work is kept so signing in again as the same account picks it up.
    ///
    /// No request path calls this by itself yet: each feature that holds a client must call
    /// it on `APIError.unauthorized` (see docs/ios-authentication.md).
    public func sessionDidExpire(for account: SignedInAccount) {
        guard case .signedIn = state, isCurrent(account) else { return }
        try? sessions.delete(server: account.server)
        bump()
        state = .signedOut(.sessionExpired(email: account.email))
    }

    /// Changes not yet synced for the signed-in account, for the sign-out warning.
    public func pendingChangeCount() async -> Int {
        guard let account = state.account else { return 0 }
        return await localData.pendingChangeCount(for: account.scope)
    }

    /// Signs out: refuses while more changes are pending than the person agreed to lose,
    /// unregisters this device's push registration while the session still works, revokes the
    /// session on the server, deletes the token and removes the account's local entries.
    ///
    /// The account's local data takes no saves from the moment it is counted
    /// (`AccountLocalData.beginRemoval`) until it is removed, so a save made during sign-out
    /// is refused (the draft stays) rather than acknowledged and then deleted. When sign-out
    /// does not go ahead, saves resume.
    ///
    /// - Parameters:
    ///   - consented: "Sign out anyway": how many unsynced changes the person agreed to lose
    ///     (the count they were shown). More than that pending throws `pendingChanges` with
    ///     the new count, so they are asked again.
    ///   - removeEvenIfUnreachable: sign out on this device when the server cannot be
    ///     reached; the server session then stays valid until it expires.
    public func signOut(discardingUpTo consented: Int = 0, removeEvenIfUnreachable: Bool = false)
        async throws(SignOutFailure)
    {
        await finishEmailMigration()
        guard case .signedIn(let account) = state else { throw .notSignedIn }
        let pending = await localData.beginRemoval(for: account.scope)
        do throws(SignOutFailure) {
            try await signOut(
                account, pending: pending, consented: consented, removeEvenIfUnreachable: removeEvenIfUnreachable)
        } catch {
            await localData.cancelRemoval(for: account.scope)
            throw error
        }
    }

    /// `signOut` once the account's local data is held for removal. Throws before anything is
    /// removed; the caller then lifts the hold.
    private func signOut(
        _ account: SignedInAccount, pending: Int, consented: Int, removeEvenIfUnreachable: Bool
    ) async throws(SignOutFailure) {
        guard case .signedIn = state, isCurrent(account) else { throw .notSignedIn }
        if pending > max(0, consented) { throw .pendingChanges(count: pending) }
        guard let client = try? signedInClient(account) else { throw .notSignedIn }

        // From here nothing started for the signed-in account applies: a launch check or a
        // late 401 is dropped, and no second sign-out or other sign-in can start.
        state = .signingOut(account)
        let signingOut = bump()
        func stillSigningOut() -> Bool { generation == signingOut && state == .signingOut(account) }

        await devices.unregister(using: client)
        guard stillSigningOut() else { throw .notSignedIn }
        do {
            try await client.logout()
        } catch let error as APIError where error.requiresSignIn {
            // Already ended on the server.
        } catch {
            if !removeEvenIfUnreachable {
                if stillSigningOut() { activate(account.session, verified: account.isVerified) }
                throw .serverUnreachable
            }
        }
        guard stillSigningOut() else { throw .notSignedIn }
        try? sessions.delete(server: account.server)
        bump()
        state = .signedOut(.signedOut)
        do {
            try await localData.removeLocalData(for: account.scope)
        } catch {
            // Signed out already (the server session is gone), but the entries are still on
            // this device: say so and offer `removeUnremovedLocalData()`. Not if the same
            // account signed in again meanwhile; it is its own data then, so it takes saves.
            await localData.cancelRemoval(for: account.scope)
            if state.account?.scope != account.scope { setUnremovedLocalData(account.scope) }
        }
    }

    /// Tries again to remove the entries a sign-out could not remove (`unremovedLocalData`).
    /// Leaves `unremovedLocalData` set when it fails again.
    public func removeUnremovedLocalData() async {
        guard let scope = unremovedLocalData else { return }
        do {
            try await localData.removeLocalData(for: scope)
        } catch {
            return
        }
        if unremovedLocalData == scope { setUnremovedLocalData(nil) }
    }

    /// "Sync, then sign out".
    public func syncThenSignOut() async throws(SignOutFailure) {
        await finishEmailMigration()
        guard case .signedIn(let account) = state, let client = try? signedInClient(account) else {
            throw .notSignedIn
        }
        do {
            try await localData.syncPendingChanges(for: account.scope, using: client)
        } catch let error as APIError where error.requiresSignIn {
            sessionDidExpire(for: account)
            throw .syncFailed
        } catch {
            throw .syncFailed
        }
        guard case .signedIn = state, isCurrent(account) else { throw .notSignedIn }
        try await signOut()
    }

    /// Waits for a launch-time email change to move the account's local data, so sign-out
    /// counts, syncs and removes the scope that data ends up under.
    private func finishEmailMigration() async {
        while let migration = emailMigration { await migration.value }
    }

    // MARK: Server

    /// Checks a candidate server without sending any credential: it must answer
    /// `/api/info` as Penny within 10 seconds. Also reports whether it offers single sign-on.
    /// Saves nothing; call `useServer` with the result.
    public func checkServer(_ input: String) async throws(AuthFailure) -> ServerCheck {
        let server: ServerURL
        do { server = try ServerURL(input) } catch .notAbsolute {
            throw AuthFailure(.invalidInput, "Enter a full server URL, such as https://penny.example.com.")
        } catch {
            throw AuthFailure(.invalidInput, "Use an HTTP or HTTPS URL without credentials, a query, or a fragment.")
        }
        let client = anonymousClient(server, timeout: Self.probeTimeout)
        let info: WireServerInfo
        do {
            info = try await client.info()
        } catch let error as APIError where [.offline, .timeout, .unreachable].contains(error) {
            throw AuthFailure(
                error == .offline ? .offline : .unreachable,
                "Cannot reach this server. Check the URL, connection, and HTTPS configuration.")
        } catch {
            throw AuthFailure(
                .notAPennyServer,
                "This address did not identify itself as a Penny server. Check the URL and update older Penny servers.")
        }
        let trimmed = info.version.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, info.version.utf16.count <= 100 else {
            throw AuthFailure(
                .notAPennyServer,
                "This address did not identify itself as a Penny server. Check the URL and update older Penny servers.")
        }
        let config: WireOidcConfig?
        do { config = try await client.oidcConfiguration() } catch APIError.notFound {
            config = WireOidcConfig(enabled: false)
        } catch {
            config = nil
        }
        return ServerCheck(
            server: server, version: info.version, singleSignOn: config?.enabled,
            singleSignOnLabel: config?.enabled == true ? Self.label(config?.label) : nil)
    }

    /// Makes a checked server the one sign-in uses. Only while signed out: a signed-in
    /// account's server is read-only, so its data can never be sent to another server.
    public func useServer(_ check: ServerCheck) throws(AuthFailure) {
        guard state.canChangeServer else {
            throw AuthFailure(.busy, "Sync your entries and sign out before changing servers.")
        }
        let saved = SavedServer(server: check.server, version: check.version)
        do { try preferences.setSavedServer(saved) } catch {
            throw AuthFailure(.storage, "Could not save the server on this device. Your previous server is unchanged.")
        }
        if saved.server != server?.server {
            bump()
            // An expiry notice belongs to the previous server.
            state = .signedOut(nil)
        }
        server = saved
        singleSignOn =
            switch (check.singleSignOn, check.singleSignOnLabel) {
            case (true, let label?): .available(label: label)
            case (false, _): .unavailable
            default: .unknown
            }
    }

    // MARK: Plumbing

    private func beginSignIn() throws(AuthFailure) -> (SavedServer, SignedOutReason?) {
        guard case .signedOut(let reason) = state else {
            throw AuthFailure(.busy, "Sign-in is already in progress.")
        }
        guard let server else {
            throw AuthFailure(.noServer, "Choose your Penny server first.")
        }
        return (server, reason)
    }

    /// Saves and activates a new session. A session the Keychain refuses is revoked again, so
    /// no valid token is left behind unsaved.
    ///
    /// No staleness check is needed: while `signingIn`, nothing can change the server or the
    /// generation (`useServer`, expiry, sign-out and another sign-in all refuse), and the
    /// session comes from a client configured for `server`.
    private func install(_ session: ServerSession, previous: SignedOutReason?) async throws(AuthFailure) {
        // A fresh-install purge that failed at launch runs again first, so leftovers never
        // sit next to the new session. If it fails again, the next launch retries it (and
        // that purge also removes this session: the person signs in once more).
        try? purgeLeftoverSessionsIfNeeded()
        do {
            try sessions.save(session)
        } catch {
            state = .signedOut(previous)
            try? await logoutQuietly(session)
            throw AuthFailure(.storage, "Couldn't keep you signed in on this device. Please try again.")
        }
        _ = activate(session, verified: true)
    }

    /// Keychain items survive app deletion, so the first launch after an install deletes
    /// every saved session instead of restoring one nobody expects. Marked done only once
    /// the deletion succeeded; until then every launch (and sign-in) tries again.
    private func purgeLeftoverSessionsIfNeeded() throws(SessionStoreError) {
        guard !preferences.hasLaunchedBefore else { return }
        try sessions.deleteAll()
        preferences.markLaunched()
    }

    private func logoutQuietly(_ session: ServerSession) async throws {
        try await APIClient(
            configuration: APIConfiguration(server: session.server), session: session, transport: transport
        )
        .logout()
    }

    @discardableResult
    private func activate(_ session: ServerSession, verified: Bool) -> SignedInAccount {
        let account = SignedInAccount(session: session, generation: bump(), isVerified: verified)
        state = .signedIn(account)
        // Entries a sign-out could not remove belong to this account again.
        if unremovedLocalData == account.scope { setUnremovedLocalData(nil) }
        return account
    }

    @discardableResult
    private func bump() -> Int {
        generation += 1
        return generation
    }

    private func isCurrent(_ account: SignedInAccount) -> Bool {
        state.account?.generation == account.generation && generation == account.generation
    }

    private func signedInClient(_ account: SignedInAccount) throws -> APIClient {
        try APIClient(
            configuration: APIConfiguration(server: account.server), session: account.session, transport: transport)
    }

    private func anonymousClient(_ server: ServerURL, timeout: TimeInterval = 30) -> APIClient {
        APIClient.anonymous(APIConfiguration(server: server, requestTimeout: timeout), transport: transport)
    }

    private static func label(_ label: String?) -> String {
        let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "single sign-on" : trimmed
    }

    static let superseded = AuthFailure(.superseded, "The server changed. Please sign in again.")

    /// Turns an API failure into what the person reads and can do next.
    static func failure(_ error: any Error, during method: SignInMethod, server: ServerURL) -> AuthFailure {
        let host = server.url.host ?? server.description
        guard let error = error as? APIError else {
            return AuthFailure(.superseded, "Sign-in was interrupted. Please try again.")
        }
        switch error {
        case .offline:
            return AuthFailure(.offline, "You're offline. Connect to the internet and try again.")
        case .timeout, .unreachable:
            return AuthFailure(.unreachable, "Can't reach \(host). Check your connection and try again.")
        case .rateLimited(let after):
            let minutes = after.map { max(1, Int(($0 / 60).rounded(.up))) } ?? 15
            return AuthFailure(
                .rateLimited, "Too many attempts. Please try again in \(minutes) minute\(minutes == 1 ? "" : "s").")
        case .unauthorized(let message):
            switch method {
            case .singleSignOn:
                return AuthFailure(
                    .singleSignOnRejected, message ?? "Sign-in could not be verified. Please try again.")
            default:
                return AuthFailure(.invalidCredentials, message ?? "Email or password is incorrect.")
            }
        case .badRequest(let message):
            if method == .singleSignOn {
                return AuthFailure(
                    .singleSignOnUnavailable, message ?? "Single sign-on is unavailable. Please try again.")
            }
            return AuthFailure(.invalidInput, message ?? "Enter a valid email and a password of 10–256 characters.")
        case .forbidden(let message):
            return AuthFailure(
                method == .singleSignOn ? .singleSignOnRejected : .registrationDisabled,
                message ?? "This server doesn't allow new accounts.")
        case .conflict(let message):
            return AuthFailure(.accountExists, message ?? "An account already uses this email.")
        case .notFound(let message):
            if method == .singleSignOn {
                return AuthFailure(
                    .singleSignOnUnavailable, message ?? "Single sign-on is not configured on this server.")
            }
            return AuthFailure(.notAPennyServer, "This server doesn't support sign-in. Check the server address.")
        case .malformedResponse, .unexpectedStatus:
            return AuthFailure(
                .server,
                "\(host) answered in a way Penny doesn't understand. Check that it runs a current Penny version.")
        case .invalidRequest:
            return AuthFailure(.invalidInput, "Check the details and try again.")
        case .payloadTooLarge, .unavailable, .server:
            return AuthFailure(.server, "\(host) had a problem. Please try again in a moment.")
        }
    }
}
