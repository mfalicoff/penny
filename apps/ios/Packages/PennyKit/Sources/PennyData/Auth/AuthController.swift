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
        if !preferences.hasLaunchedBefore {
            // Keychain items survive app deletion; a reinstall starts signed out.
            do { try sessions.deleteAll() } catch .unavailable {
                state = .keychainUnavailable
                return
            } catch {}
            preferences.markLaunched()
        }
        server = preferences.savedServer() ?? defaultServer.map { SavedServer(server: $0) }
        guard let server else {
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
        do {
            let me = try await client.me()
            guard isCurrent(account) else { return }
            if me.email.lowercased() == account.email.lowercased() {
                var verified = account
                verified.isVerified = true
                state = .signedIn(verified)
            } else if let session = try? ServerSession(
                server: account.server, email: me.email, token: account.session.tokenForStorage)
            {
                // The token is the authority: show the account it belongs to, under its own
                // scope, never the previously stored one.
                try? sessions.save(session)
                _ = activate(session, verified: true)
            }
        } catch let error as APIError where error.requiresSignIn {
            sessionDidExpire(for: account.scope)
        } catch {
            // Offline or a server problem: stay signed in with local data, unverified.
        }
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
        try await install(session, attempt: attempt, previous: previous)
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
        guard challenge.expiry > now() else {
            reset()
            throw AuthFailure(.singleSignOnExpired, "Sign-in expired. Please try again.")
        }
        let pending = PendingSingleSignOn(
            id: attempt, server: server.server, transaction: challenge.transaction, expiry: challenge.expiry)
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
        guard pending.expiry > now() else {
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
        try await install(session, attempt: attempt, previous: previous)
        return .signedIn
    }

    // MARK: Expiry and sign-out

    /// Call when any request for `scope` answers 401. Only the current account's own 401
    /// ends its session; a late answer for an earlier account is ignored. Local work is
    /// kept so signing in again as the same account picks it up.
    public func sessionDidExpire(for scope: AccountScope) {
        guard let account = state.account, account.scope == scope else { return }
        try? sessions.delete(server: scope.server)
        bump()
        state = .signedOut(.sessionExpired(email: account.email))
    }

    /// Changes not yet synced for the signed-in account, for the sign-out warning.
    public func pendingChangeCount() async -> Int {
        guard let account = state.account else { return 0 }
        return await localData.pendingChangeCount(for: account.scope)
    }

    /// Signs out: refuses while changes are pending (unless discarded), unregisters this
    /// device's push registration while the session still works, revokes the session on the
    /// server, deletes the token and removes the account's local entries.
    ///
    /// - Parameters:
    ///   - discardingPendingChanges: "Sign out anyway": unsynced changes are lost.
    ///   - removeEvenIfUnreachable: sign out on this device when the server cannot be
    ///     reached; the server session then stays valid until it expires.
    public func signOut(discardingPendingChanges: Bool = false, removeEvenIfUnreachable: Bool = false)
        async throws(SignOutFailure)
    {
        guard case .signedIn(let account) = state else { throw .notSignedIn }
        let pending = await localData.pendingChangeCount(for: account.scope)
        guard isCurrent(account) else { throw .notSignedIn }
        if pending > 0, !discardingPendingChanges { throw .pendingChanges(count: pending) }
        guard let client = try? signedInClient(account) else { throw .notSignedIn }

        state = .signingOut(account)
        await devices.unregister(using: client)
        do {
            try await client.logout()
        } catch let error as APIError where error.requiresSignIn {
            // Already ended on the server.
        } catch {
            if !removeEvenIfUnreachable {
                if state == .signingOut(account) { state = .signedIn(account) }
                throw .serverUnreachable
            }
        }
        try? sessions.delete(server: account.server)
        bump()
        state = .signedOut(.signedOut)
        try? await localData.removeLocalData(for: account.scope)
    }

    /// "Sync, then sign out".
    public func syncThenSignOut() async throws(SignOutFailure) {
        guard case .signedIn(let account) = state, let client = try? signedInClient(account) else {
            throw .notSignedIn
        }
        do {
            try await localData.syncPendingChanges(for: account.scope, using: client)
        } catch let error as APIError where error.requiresSignIn {
            sessionDidExpire(for: account.scope)
            throw .syncFailed
        } catch {
            throw .syncFailed
        }
        guard isCurrent(account) else { throw .notSignedIn }
        try await signOut()
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

    /// Saves and activates a new session, unless the attempt was superseded. A session the
    /// Keychain refuses is revoked again, so no valid token is left behind unsaved.
    private func install(_ session: ServerSession, attempt: Int, previous: SignedOutReason?) async throws(AuthFailure) {
        guard attempt == generation, session.server == server?.server else {
            try? await logoutQuietly(session)
            throw Self.superseded
        }
        do {
            try sessions.save(session)
        } catch {
            state = .signedOut(previous)
            try? await logoutQuietly(session)
            throw AuthFailure(.storage, "Couldn't keep you signed in on this device. Please try again.")
        }
        _ = activate(session, verified: true)
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
