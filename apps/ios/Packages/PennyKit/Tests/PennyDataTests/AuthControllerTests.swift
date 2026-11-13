import Foundation
import PennyData
import PennyDomain
import Security
import Testing

@Suite("Auth state machine")
@MainActor
struct AuthControllerTests {
    private let email = "contract-user@example.test"
    private var scope: AccountScope { AccountScope(server: AuthFixtures.server, email: email) }

    // MARK: Restore

    @Test("whenNoServerChosen_AuthController_ShouldRestoreSignedOut")
    func restoreWithoutServer() async {
        let transport = Routes.transport([:])
        let controller = AuthFixtures.controller(transport: transport, preferences: EphemeralAuthPreferences())
        await controller.restore()
        #expect(controller.state == .signedOut(nil))
        #expect(controller.server == nil)
        #expect(transport.sent.isEmpty)
    }

    @Test("whenDebugDefaultServer_AuthController_ShouldOfferItBeforeAChoiceIsSaved")
    func restoreUsesDefault() async {
        let controller = AuthFixtures.controller(
            transport: Routes.transport([:]), preferences: EphemeralAuthPreferences(),
            defaultServer: AuthFixtures.server)
        await controller.restore()
        #expect(controller.server?.server == AuthFixtures.server)
    }

    @Test("whenFreshInstall_AuthController_ShouldDeleteSessionsALeftoverKeychainStillHolds")
    func freshInstallPurges() async throws {
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let preferences = EphemeralAuthPreferences(
            server: SavedServer(server: AuthFixtures.server), launchedBefore: false)
        let transport = Routes.transport(["GET /api/auth/me": Routes.json(#"{"email":"\#(email)"}"#)])
        let controller = AuthFixtures.controller(transport: transport, sessions: sessions, preferences: preferences)
        await controller.restore()
        #expect(controller.state == .signedOut(nil))
        #expect(try sessions.load(server: AuthFixtures.server) == nil)
        #expect(preferences.hasLaunchedBefore)
        #expect(transport.sent.isEmpty)
    }

    @Test("whenSavedSessionConfirmed_AuthController_ShouldBeSignedInAndVerified")
    func restoreVerified() async throws {
        let transport = Routes.transport(["GET /api/auth/me": Routes.json(#"{"email":"\#(email)"}"#)])
        let controller = AuthFixtures.controller(
            transport: transport, sessions: EphemeralSessionStore([APIFixtures.session()]))
        await controller.restore()
        let account = try #require(controller.state.account)
        #expect(account.isVerified)
        #expect(account.scope == scope)
        #expect(transport.sent.first?.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
        #expect(controller.client?.scope == scope)
    }

    @Test("whenOfflineAtLaunch_AuthController_ShouldStaySignedInUnverified")
    func restoreOffline() async throws {
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/me": Routes.fail(.notConnectedToInternet)]), sessions: sessions)
        await controller.restore()
        let account = try #require(controller.state.account)
        #expect(!account.isVerified)
        #expect(try sessions.load(server: AuthFixtures.server) != nil)
    }

    @Test("whenSavedSessionExpired_AuthController_ShouldSignOutWithNoticeAndDeleteTheToken")
    func restoreExpired() async throws {
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let localData = FakeLocalData()
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "GET /api/auth/me": Routes.json(401, #"{"error":"Please sign in to continue."}"#)
            ]),
            sessions: sessions, localData: localData)
        await controller.restore()
        #expect(controller.state == .signedOut(.sessionExpired(email: email)))
        #expect(try sessions.load(server: AuthFixtures.server) == nil)
        #expect(controller.client == nil)
        // Local work is kept for when the same account signs in again.
        #expect(localData.log.all.isEmpty)
    }

    @Test("whenKeychainLockedAtLaunch_AuthController_ShouldWaitWithoutSigningOutThenRestoreAfterUnlock")
    func restoreLocked() async throws {
        let keychain = FakeKeychain()
        let sessions = KeychainSessionStore(backend: keychain)
        try sessions.save(APIFixtures.session())
        keychain.forcedStatus.withLock { $0 = errSecInteractionNotAllowed }
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/me": Routes.json(#"{"email":"\#(email)"}"#)]),
            sessions: sessions)
        await controller.restore()
        #expect(controller.state == .keychainUnavailable)
        #expect(!controller.state.canChangeServer)

        keychain.forcedStatus.withLock { $0 = nil }
        await controller.restore()
        #expect(controller.state.account?.isVerified == true)
    }

    @Test("whenTokenBelongsToAnotherEmail_AuthController_ShouldShowTheServersAccountUnderItsOwnScope")
    func restoreEmailChanged() async throws {
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/me": Routes.json(#"{"email":"renamed@example.test"}"#)]),
            sessions: sessions)
        await controller.restore()
        #expect(
            controller.state.account?.scope == AccountScope(server: AuthFixtures.server, email: "renamed@example.test"))
        #expect(try sessions.load(server: AuthFixtures.server)?.email == "renamed@example.test")
    }

    @Test("whenFreshInstallPurgeFails_AuthController_ShouldRestoreNothingAndRetryAtTheNextLaunch")
    func freshInstallPurgeFails() async throws {
        let keychain = FakeKeychain()
        let sessions = KeychainSessionStore(backend: keychain)
        try sessions.save(APIFixtures.session())
        keychain.deleteStatus.withLock { $0 = errSecIO }
        let preferences = EphemeralAuthPreferences(
            server: SavedServer(server: AuthFixtures.server), launchedBefore: false)
        let transport = Routes.transport(["GET /api/auth/me": Routes.json(#"{"email":"\#(email)"}"#)])
        let controller = AuthFixtures.controller(transport: transport, sessions: sessions, preferences: preferences)
        await controller.restore()
        #expect(controller.state == .signedOut(nil))
        #expect(!preferences.hasLaunchedBefore)
        #expect(transport.sent.isEmpty)

        keychain.deleteStatus.withLock { $0 = nil }
        let relaunched = AuthFixtures.controller(transport: transport, sessions: sessions, preferences: preferences)
        await relaunched.restore()
        #expect(relaunched.state == .signedOut(nil))
        #expect(preferences.hasLaunchedBefore)
        #expect(try sessions.load(server: AuthFixtures.server) == nil)
    }

    @Test("whenFreshInstallPurgeFailedAtLaunch_AuthController_ShouldRetryItBeforeSavingANewSession")
    func freshInstallPurgeRetriedAtSignIn() async throws {
        let keychain = FakeKeychain()
        let sessions = KeychainSessionStore(backend: keychain)
        try sessions.save(APIFixtures.session(server: APIFixtures.otherServer))
        keychain.deleteStatus.withLock { $0 = errSecIO }
        let preferences = EphemeralAuthPreferences(
            server: SavedServer(server: AuthFixtures.server), launchedBefore: false)
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["POST /api/auth/login": Routes.json(Routes.session(email))]),
            sessions: sessions, preferences: preferences)
        await controller.restore()
        keychain.deleteStatus.withLock { $0 = nil }
        try await controller.signIn(email: email, password: "correct horse")
        #expect(preferences.hasLaunchedBefore)
        #expect(try sessions.load(server: APIFixtures.otherServer) == nil)
        #expect(try sessions.load(server: AuthFixtures.server)?.email == email)
    }

    @Test("whenEmailChangedAtLaunch_AuthController_ShouldMoveTheOldScopesLocalDataToTheNewOne")
    func restoreEmailChangedMovesLocalData() async throws {
        let localData = FakeLocalData()
        localData.pending.withLock { $0[scope] = 2 }
        let renamed = AccountScope(server: AuthFixtures.server, email: "renamed@example.test")
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/me": Routes.json(#"{"email":"renamed@example.test"}"#)]),
            sessions: EphemeralSessionStore([APIFixtures.session()]), localData: localData)
        await controller.restore()
        #expect(controller.state.account?.scope == renamed)
        #expect(localData.log.all == ["move \(email) -> renamed@example.test"])
        #expect(await controller.pendingChangeCount() == 2)
    }

    @Test("whenLocalDataCannotMoveAfterAnEmailChange_AuthController_ShouldStayOnTheStoredScopeUnverified")
    func restoreEmailChangedMoveFails() async throws {
        let localData = FakeLocalData()
        localData.moveError.withLock { $0 = CocoaError(.fileWriteUnknown) }
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/me": Routes.json(#"{"email":"renamed@example.test"}"#)]),
            sessions: sessions, localData: localData)
        await controller.restore()
        #expect(controller.state.account?.scope == scope)
        #expect(controller.state.account?.isVerified == false)
        #expect(try sessions.load(server: AuthFixtures.server)?.email == email)
    }

    @Test("whenSessionEndsWhileLaunchCheckIsInFlight_AuthController_ShouldIgnoreTheLateConfirmation")
    func restoreStaleAnswer() async throws {
        let gate = Gate()
        let transport = Routes.transport([
            "GET /api/auth/me": { _ in
                await gate.wait()
                return HTTPResult(status: 200, body: Data(#"{"email":"contract-user@example.test"}"#.utf8))
            }
        ])
        let controller = AuthFixtures.controller(
            transport: transport, sessions: EphemeralSessionStore([APIFixtures.session()]))
        let restoring = Task { await controller.restore() }
        while transport.sent.isEmpty { await Task.yield() }
        controller.sessionDidExpire(for: try #require(controller.state.account))
        gate.open()
        await restoring.value
        #expect(controller.state == .signedOut(.sessionExpired(email: email)))
    }

    // MARK: Password

    @Test("whenPasswordCorrect_AuthController_ShouldSaveTheSessionForThisServerAndSignIn")
    func signIn() async throws {
        let sessions = EphemeralSessionStore()
        let transport = Routes.transport(["POST /api/auth/login": Routes.json(Routes.session(email))])
        let controller = AuthFixtures.controller(transport: transport, sessions: sessions)
        await controller.restore()
        try await controller.signIn(email: "  \(email) ", password: "correct horse")
        #expect(controller.state.account?.scope == scope)
        #expect(controller.state.account?.isVerified == true)
        #expect(try sessions.load(server: AuthFixtures.server)?.email == email)
        let request = try #require(transport.sent.first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try APIFixtures.object(request.httpBody)
        #expect(body["email"] as? String == email)
    }

    @Test("whenPasswordWrong_AuthController_ShouldReturnToSignedOutWithTheServersMessage")
    func signInFails() async throws {
        let transport = Routes.transport([
            "POST /api/auth/login": Routes.json(401, #"{"error":"Email or password is incorrect."}"#)
        ])
        let sessions = EphemeralSessionStore()
        let controller = AuthFixtures.controller(transport: transport, sessions: sessions)
        await controller.restore()
        await #expect(throws: AuthFailure(.invalidCredentials, "Email or password is incorrect.")) {
            try await controller.signIn(email: email, password: "wrong password")
        }
        #expect(controller.state == .signedOut(nil))
        #expect(try sessions.load(server: AuthFixtures.server) == nil)
    }

    @Test("whenSignInFailsAfterExpiry_AuthController_ShouldKeepTheExpiryNotice")
    func signInFailsKeepsNotice() async throws {
        let transport = Routes.transport([
            "GET /api/auth/me": Routes.json(401, "{}"), "POST /api/auth/login": Routes.fail(.timedOut),
        ])
        let controller = AuthFixtures.controller(
            transport: transport, sessions: EphemeralSessionStore([APIFixtures.session()]))
        await controller.restore()
        do {
            try await controller.signIn(email: email, password: "correct horse")
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .unreachable)
            #expect(error.message.contains("penny.example.test"))
        }
        #expect(controller.state == .signedOut(.sessionExpired(email: email)))
    }

    @Test("whenOffline_AuthController_ShouldSayToConnect")
    func signInOffline() async {
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["POST /api/auth/login": Routes.fail(.notConnectedToInternet)]))
        await controller.restore()
        do {
            try await controller.signIn(email: email, password: "correct horse")
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .offline)
        }
    }

    @Test("whenRateLimited_AuthController_ShouldSayWhenToRetry")
    func signInRateLimited() async {
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": Routes.json(429, "{}", headers: ["retry-after": "120"])
            ]))
        await controller.restore()
        await #expect(throws: AuthFailure(.rateLimited, "Too many attempts. Please try again in 2 minutes.")) {
            try await controller.signIn(email: email, password: "correct horse")
        }
    }

    @Test("whenFieldsEmptyOrPasswordShort_AuthController_ShouldRefuseWithoutSending")
    func localValidation() async {
        let transport = Routes.transport([:])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        await #expect(throws: AuthFailure(.invalidInput, "Enter your email and password.")) {
            try await controller.signIn(email: "  ", password: "x")
        }
        await #expect(throws: AuthFailure(.invalidInput, "Use a password of 10–256 characters.")) {
            try await controller.register(email: email, password: "short")
        }
        #expect(transport.sent.isEmpty)
        #expect(controller.state == .signedOut(nil))
    }

    @Test("whenRegistering_AuthController_ShouldMapPolicyAndDuplicateErrors")
    func registerErrors() async {
        let disabled = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/register": Routes.json(
                    403, #"{"error":"Account registration is disabled on this server."}"#)
            ]))
        await disabled.restore()
        await #expect(throws: AuthFailure(.registrationDisabled, "Account registration is disabled on this server.")) {
            try await disabled.register(email: email, password: "long enough pass")
        }
        let duplicate = AuthFixtures.controller(
            transport: Routes.transport(["POST /api/auth/register": Routes.json(409, #"{"error":"Taken."}"#)]))
        await duplicate.restore()
        await #expect(throws: AuthFailure(.accountExists, "Taken.")) {
            try await duplicate.register(email: email, password: "long enough pass")
        }
    }

    @Test("whenRegistered_AuthController_ShouldBeSignedIn")
    func register() async throws {
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["POST /api/auth/register": Routes.json(201, Routes.session(email))]))
        await controller.restore()
        try await controller.register(email: email, password: "long enough pass")
        #expect(controller.state.account?.email == email)
    }

    @Test("whenAlreadySigningIn_AuthController_ShouldRefuseASecondAttempt")
    func busy() async throws {
        let gate = Gate()
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": { _ in
                    await gate.wait()
                    return HTTPResult(status: 200, body: Data(Routes.session("contract-user@example.test").utf8))
                }
            ]))
        await controller.restore()
        let first = Task { try await controller.signIn(email: email, password: "correct horse") }
        while controller.state == .signedOut(nil) { await Task.yield() }
        #expect(controller.state == .signingIn(.password))
        await #expect(throws: AuthFailure.self) { try await controller.signIn(email: email, password: "again") }
        #expect(!controller.state.canChangeServer)
        gate.open()
        try await first.value
        #expect(controller.state.account != nil)
    }

    @Test("whenKeychainRefusesTheSession_AuthController_ShouldRevokeItAndStaySignedOut")
    func storageFailure() async throws {
        let keychain = FakeKeychain()
        keychain.addStatus.withLock { $0 = errSecNotAvailable }
        let transport = Routes.transport([
            "POST /api/auth/login": Routes.json(Routes.session(email)),
            "POST /api/auth/logout": Routes.json(#"{"ok":true}"#),
        ])
        let controller = AuthFixtures.controller(
            transport: transport, sessions: KeychainSessionStore(backend: keychain))
        await controller.restore()
        do {
            try await controller.signIn(email: email, password: "correct horse")
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .storage)
        }
        #expect(controller.state == .signedOut(nil))
        #expect(transport.paths() == ["POST /api/auth/login", "POST /api/auth/logout"])
        #expect(transport.sent.last?.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
    }

    // MARK: Expiry and account switching

    @Test("whenAnotherAccountsRequestAnswers401_AuthController_ShouldKeepTheCurrentAccount")
    func staleExpiryIgnored() async throws {
        let other = "earlier@example.test"
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": { request in
                    let email = try APIFixtures.object(request.httpBody)["email"] as? String ?? ""
                    return HTTPResult(status: 200, body: Data(Routes.session(email).utf8))
                }
            ]))
        await controller.restore()
        try await controller.signIn(email: other, password: "correct horse")
        let earlier = try #require(controller.state.account)
        controller.sessionDidExpire(for: earlier)
        try await controller.signIn(email: email, password: "correct horse")
        controller.sessionDidExpire(for: earlier)
        #expect(controller.state.account?.scope == scope)
    }

    @Test("whenSignOutCannotRemoveLocalData_AuthController_ShouldSignOutAndOfferToRemoveItAgain")
    func signOutRemovalFails() async throws {
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData)
        localData.removeError.withLock { $0 = CocoaError(.fileWriteUnknown) }
        try await controller.signOut()
        #expect(controller.state == .signedOut(.signedOut))
        #expect(controller.unremovedLocalData == scope)

        await controller.removeUnremovedLocalData()
        #expect(controller.unremovedLocalData == scope)
        localData.removeError.withLock { $0 = nil }
        await controller.removeUnremovedLocalData()
        #expect(controller.unremovedLocalData == nil)
        #expect(localData.log.all.filter { $0 == "remove \(email)" }.count == 3)
    }

    @Test("whenTheAppRelaunchesAfterSignOutCouldNotRemoveLocalData_AuthController_ShouldStillOfferToRemoveIt")
    func unremovedLocalDataSurvivesRelaunch() async throws {
        let localData = FakeLocalData()
        let preferences = EphemeralAuthPreferences(server: SavedServer(server: AuthFixtures.server))
        let (controller, transport) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData, preferences: preferences)
        localData.removeError.withLock { $0 = CocoaError(.fileWriteUnknown) }
        try await controller.signOut()
        #expect(preferences.unremovedLocalData() == scope)

        // A new process: only the preferences remain.
        let relaunched = AuthFixtures.controller(transport: transport, preferences: preferences, localData: localData)
        await relaunched.restore()
        #expect(relaunched.unremovedLocalData == scope)
        localData.removeError.withLock { $0 = nil }
        await relaunched.removeUnremovedLocalData()
        #expect(relaunched.unremovedLocalData == nil)
        #expect(preferences.unremovedLocalData() == nil)
    }

    @Test("whenStored_UserDefaultsAuthPreferences_ShouldKeepTheUnremovedAccount")
    func unremovedLocalDataInUserDefaults() throws {
        let suite = "penny.tests.\(UUID().uuidString)"
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        let preferences = UserDefaultsAuthPreferences(suiteName: suite)
        #expect(preferences.unremovedLocalData() == nil)
        preferences.setUnremovedLocalData(scope)
        #expect(UserDefaultsAuthPreferences(suiteName: suite).unremovedLocalData() == scope)
        preferences.setUnremovedLocalData(nil)
        #expect(preferences.unremovedLocalData() == nil)
    }

    @Test("whenAnEarlierSessionOfTheSameAccountAnswers401_AuthController_ShouldKeepTheNewerSession")
    func staleExpiryOfSameAccountIgnored() async throws {
        let sessions = EphemeralSessionStore()
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["POST /api/auth/login": Routes.json(Routes.session(email))]),
            sessions: sessions)
        await controller.restore()
        try await controller.signIn(email: email, password: "correct horse")
        let first = try #require(controller.state.account)
        controller.sessionDidExpire(for: first)
        try await controller.signIn(email: email, password: "correct horse")
        let second = try #require(controller.state.account)
        // A late 401 for the first session must not end the second one.
        controller.sessionDidExpire(for: first)
        #expect(controller.state == .signedIn(second))
        #expect(try sessions.load(server: AuthFixtures.server) != nil)
    }

    @Test("whenLaunchCheckAnswers401AfterTheSameAccountSignedInAgain_AuthController_ShouldKeepTheNewSession")
    func staleLaunch401Ignored() async throws {
        let gate = Gate()
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let transport = Routes.transport([
            "GET /api/auth/me": { _ in
                await gate.wait()
                return HTTPResult(status: 401, body: Data("{}".utf8))
            },
            "POST /api/auth/login": Routes.json(Routes.session(email, token: AuthFixtures.otherToken)),
        ])
        let controller = AuthFixtures.controller(transport: transport, sessions: sessions)
        let restoring = Task { await controller.restore() }
        while transport.sent.isEmpty { await Task.yield() }
        let restored = try #require(controller.state.account)
        controller.sessionDidExpire(for: restored)
        try await controller.signIn(email: email, password: "correct horse")
        let current = try #require(controller.state.account)
        gate.open()
        await restoring.value
        #expect(controller.state == .signedIn(current))
        #expect(try sessions.load(server: AuthFixtures.server)?.tokenForStorage == AuthFixtures.otherToken)
    }

    @Test("whenSyncBeforeSignOutAnswers401AfterTheSameAccountSignedInAgain_AuthController_ShouldKeepTheNewSession")
    func staleSync401Ignored() async throws {
        let gate = Gate()
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn([:], localData: localData)
        localData.pending.withLock { $0[scope] = 1 }
        localData.syncGate.withLock { $0 = gate }
        localData.syncError.withLock { $0 = APIError.unauthorized(message: nil) }
        let first = try #require(controller.state.account)
        let syncing = Task { try await controller.syncThenSignOut() }
        while !localData.log.all.contains("sync \(email)") { await Task.yield() }
        controller.sessionDidExpire(for: first)
        try await controller.signIn(email: email, password: "correct horse")
        let current = try #require(controller.state.account)
        gate.open()
        await #expect(throws: SignOutFailure.self) { try await syncing.value }
        #expect(controller.state == .signedIn(current))
    }

    @Test("whenSessionExpiresAndAnotherPersonSignsIn_AuthController_ShouldSwitchScopeAndForgetTheOldToken")
    func accountSwitch() async throws {
        let sessions = EphemeralSessionStore()
        let localData = FakeLocalData()
        let other = "other-person@example.test"
        let transport = Routes.transport([
            "POST /api/auth/login": { request in
                let body = try APIFixtures.object(request.httpBody)
                let email = body["email"] as? String ?? ""
                let token = email == other ? AuthFixtures.otherToken : APIFixtures.token
                return HTTPResult(status: 200, body: Data(Routes.session(email, token: token).utf8))
            }
        ])
        let controller = AuthFixtures.controller(transport: transport, sessions: sessions, localData: localData)
        await controller.restore()
        try await controller.signIn(email: email, password: "correct horse")
        let first = try #require(controller.state.account)
        controller.sessionDidExpire(for: first)
        #expect(controller.state == .signedOut(.sessionExpired(email: email)))
        #expect(try sessions.load(server: AuthFixtures.server) == nil)

        try await controller.signIn(email: other, password: "another horse")
        let second = try #require(controller.state.account)
        #expect(second.scope != first.scope)
        #expect(second.generation > first.generation)
        #expect(controller.client?.scope == second.scope)
        #expect(try sessions.load(server: AuthFixtures.server)?.email == other)
        // The first account's local entries were not shown, synced or removed for the second.
        #expect(localData.log.all.isEmpty)
    }

    // MARK: Sign-out

    private func signedIn(
        _ routes: [String: Routes.Answer], localData: FakeLocalData = FakeLocalData(),
        sessions: EphemeralSessionStore = EphemeralSessionStore(),
        preferences: EphemeralAuthPreferences = EphemeralAuthPreferences(
            server: SavedServer(server: AuthFixtures.server))
    ) async throws -> (AuthController, StubTransport) {
        var all = routes
        all["POST /api/auth/login"] = Routes.json(Routes.session(email))
        // Requests, device registration and local data share one ordered log.
        let transport = Routes.transport(all, log: localData.log)
        let controller = AuthFixtures.controller(
            transport: transport, sessions: sessions, preferences: preferences, localData: localData,
            log: localData.log)
        await controller.restore()
        try await controller.signIn(email: email, password: "correct horse")
        return (controller, transport)
    }

    @Test("whenSigningOut_AuthController_ShouldUnregisterTheDeviceThenRevokeThenRemoveLocalData")
    func signOut() async throws {
        let localData = FakeLocalData()
        let sessions = EphemeralSessionStore()
        let (controller, transport) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData, sessions: sessions)
        try await controller.signOut()
        #expect(controller.state == .signedOut(.signedOut))
        #expect(
            localData.log.all == [
                "POST /api/auth/login", "unregister \(email)", "POST /api/auth/logout", "remove \(email)",
            ])
        #expect(transport.paths().last == "POST /api/auth/logout")
        #expect(transport.sent.last?.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
        #expect(try sessions.load(server: AuthFixtures.server) == nil)
        #expect(controller.client == nil)
    }

    @Test("whenChangesArePending_AuthController_ShouldRefuseToSignOutAndSendNothing")
    func signOutPending() async throws {
        let localData = FakeLocalData()
        let (controller, transport) = try await signedIn([:], localData: localData)
        localData.pending.withLock { $0[scope] = 2 }
        #expect(await controller.pendingChangeCount() == 2)
        await #expect(throws: SignOutFailure.pendingChanges(count: 2)) { try await controller.signOut() }
        #expect(controller.state.account != nil)
        #expect(transport.paths() == ["POST /api/auth/login"])
        #expect(localData.log.all == ["POST /api/auth/login"])
    }

    @Test("whenSignOutAnyway_AuthController_ShouldDiscardPendingChanges")
    func signOutAnyway() async throws {
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData)
        localData.pending.withLock { $0[scope] = 2 }
        try await controller.signOut(discardingUpTo: 2)
        #expect(controller.state == .signedOut(.signedOut))
        #expect(localData.log.all.contains("remove \(email)"))
    }

    @Test("whenMoreChangesArePendingThanThePersonAgreedToLose_AuthController_ShouldAskAgainAndRemoveNothing")
    func signOutAnywayAsksAgain() async throws {
        let localData = FakeLocalData()
        let (controller, transport) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData)
        // "Sign out anyway" was shown 2, and one more change was saved before it ran.
        localData.pending.withLock { $0[scope] = 3 }
        await #expect(throws: SignOutFailure.pendingChanges(count: 3)) {
            try await controller.signOut(discardingUpTo: 2)
        }
        #expect(controller.state.account != nil)
        #expect(transport.paths() == ["POST /api/auth/login"])
        #expect(!localData.log.all.contains("remove \(email)"))
        #expect(localData.holds.withLock { $0[scope] } == 0, "saves resume when sign-out does not go ahead")

        // The sync caught up meanwhile: nothing left to lose, so no prompt.
        localData.pending.withLock { $0[scope] = 0 }
        try await controller.signOut(discardingUpTo: 2)
        #expect(controller.state == .signedOut(.signedOut))
    }

    @Test("whenTheServerIsUnreachableAtSignOut_AuthController_ShouldLiftTheHoldOnSaves")
    func unreachableSignOutLiftsTheHold() async throws {
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn(
            ["POST /api/auth/logout": Routes.fail(.notConnectedToInternet)], localData: localData)
        await #expect(throws: SignOutFailure.serverUnreachable) { try await controller.signOut() }
        #expect(localData.holds.withLock { $0[scope] } == 0)
    }

    @Test("whenSyncThenSignOut_AuthController_ShouldSyncFirst")
    func syncThenSignOut() async throws {
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData)
        localData.pending.withLock { $0[scope] = 2 }
        try await controller.syncThenSignOut()
        #expect(
            localData.log.all == [
                "POST /api/auth/login", "sync \(email)", "unregister \(email)", "POST /api/auth/logout",
                "remove \(email)",
            ])
        #expect(controller.state == .signedOut(.signedOut))
    }

    @Test("whenSyncFailsBeforeSignOut_AuthController_ShouldKeepTheAccountAndItsChanges")
    func syncFails() async throws {
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn([:], localData: localData)
        localData.pending.withLock { $0[scope] = 1 }
        localData.syncError.withLock { $0 = APIError.offline }
        await #expect(throws: SignOutFailure.syncFailed) { try await controller.syncThenSignOut() }
        #expect(controller.state.account != nil)
        #expect(!localData.log.all.contains("remove \(email)"))
    }

    @Test("whenServerUnreachableAtSignOut_AuthController_ShouldStaySignedInUnlessAskedToRemoveAnyway")
    func signOutOffline() async throws {
        let localData = FakeLocalData()
        let sessions = EphemeralSessionStore()
        let (controller, _) = try await signedIn(
            ["POST /api/auth/logout": Routes.fail(.notConnectedToInternet)], localData: localData, sessions: sessions)
        await #expect(throws: SignOutFailure.serverUnreachable) { try await controller.signOut() }
        #expect(controller.state.account != nil)
        #expect(try sessions.load(server: AuthFixtures.server) != nil)
        // The device was unregistered first: the registration is told to register it again.
        #expect(
            localData.log.all.suffix(3) == [
                "unregister \(email)", "POST /api/auth/logout", "signOutCancelled \(email)",
            ])

        try await controller.signOut(removeEvenIfUnreachable: true)
        #expect(controller.state == .signedOut(.signedOut))
        #expect(try sessions.load(server: AuthFixtures.server) == nil)
        #expect(localData.log.all.filter { $0.hasPrefix("signOutCancelled") }.count == 1, "not when it goes ahead")
    }

    @Test("whenSessionAlreadyEndedOnServer_AuthController_ShouldStillSignOut")
    func signOutAlreadyRevoked() async throws {
        let (controller, _) = try await signedIn(["POST /api/auth/logout": Routes.json(401, "{}")])
        try await controller.signOut()
        #expect(controller.state == .signedOut(.signedOut))
    }

    /// A saved session whose launch check (`/me`) and logout both wait for the test.
    private func restoredWithHeldLaunchCheck(
        me: Gate, logout: Gate, meStatus: Int, sessions: EphemeralSessionStore, localData: FakeLocalData
    ) -> (AuthController, StubTransport) {
        let email = email
        let transport = Routes.transport(
            [
                "GET /api/auth/me": { _ in
                    await me.wait()
                    return HTTPResult(status: meStatus, body: Data(#"{"email":"\#(email)"}"#.utf8))
                },
                "POST /api/auth/logout": { _ in
                    await logout.wait()
                    return HTTPResult(status: 200, body: Data(#"{"ok":true}"#.utf8))
                },
                "POST /api/auth/login": Routes.json(Routes.session("other-person@example.test")),
            ], log: localData.log)
        let controller = AuthFixtures.controller(
            transport: transport, sessions: sessions, localData: localData, log: localData.log)
        return (controller, transport)
    }

    @Test("whenLaunchCheckConfirmsWhileSigningOut_AuthController_ShouldStaySigningOutAndRefuseASecondSignOut")
    func launchConfirmationDuringSignOut() async throws {
        let (me, logout) = (Gate(), Gate())
        let localData = FakeLocalData()
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let (controller, _) = restoredWithHeldLaunchCheck(
            me: me, logout: logout, meStatus: 200, sessions: sessions, localData: localData)
        let restoring = Task { await controller.restore() }
        while !localData.log.all.contains("GET /api/auth/me") { await Task.yield() }
        let signingOut = Task { try await controller.signOut() }
        while !localData.log.all.contains("POST /api/auth/logout") { await Task.yield() }
        me.open()
        await restoring.value
        guard case .signingOut = controller.state else {
            Issue.record("the launch check overwrote signing out: \(controller.state)")
            logout.open()
            return
        }
        await #expect(throws: SignOutFailure.notSignedIn) { try await controller.signOut() }
        logout.open()
        try await signingOut.value
        #expect(controller.state == .signedOut(.signedOut))
        #expect(localData.log.all.filter { $0 == "POST /api/auth/logout" }.count == 1)
    }

    @Test("whenLaunchCheckAnswers401WhileSigningOut_AuthController_ShouldNotLetAnotherAccountSignInUntilItEnds")
    func launchExpiryDuringSignOut() async throws {
        let (me, logout) = (Gate(), Gate())
        let localData = FakeLocalData()
        let sessions = EphemeralSessionStore([APIFixtures.session()])
        let (controller, _) = restoredWithHeldLaunchCheck(
            me: me, logout: logout, meStatus: 401, sessions: sessions, localData: localData)
        let restoring = Task { await controller.restore() }
        while !localData.log.all.contains("GET /api/auth/me") { await Task.yield() }
        let signingOut = Task { try await controller.signOut() }
        while !localData.log.all.contains("POST /api/auth/logout") { await Task.yield() }
        me.open()
        await restoring.value
        // The sign-out in progress owns the state: nobody else can sign in under it.
        await #expect(throws: AuthFailure.self) {
            try await controller.signIn(email: "other-person@example.test", password: "another horse")
        }
        logout.open()
        try await signingOut.value
        #expect(controller.state == .signedOut(.signedOut))
        #expect(!localData.log.all.contains("POST /api/auth/login"))
        #expect(localData.log.all.filter { $0.hasPrefix("remove") } == ["remove \(email)"])
    }

    @Test("whenSignedOut_AuthController_ShouldRefuseSignOut")
    func signOutWhenSignedOut() async {
        let controller = AuthFixtures.controller(transport: Routes.transport([:]))
        await controller.restore()
        await #expect(throws: SignOutFailure.notSignedIn) { try await controller.signOut() }
    }

    // MARK: Server

    @Test("whenCheckingAServerWhileSignedIn_AuthController_ShouldSendItNoCredentialAndKeepTheServer")
    func checkServerSendsNoToken() async throws {
        let (controller, transport) = try await signedIn([
            "GET /api/info": Routes.json(AuthFixtures.info),
            "GET /api/auth/oidc": Routes.json(#"{"enabled":true,"label":"Company ID"}"#),
        ])
        let check = try await controller.checkServer("https://penny.example.test/")
        #expect(
            check
                == ServerCheck(
                    server: AuthFixtures.server, version: "2.0.0", singleSignOn: true, singleSignOnLabel: "Company ID"))
        #expect(check.isEncrypted)
        for request in transport.sent.dropFirst() {
            #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
            #expect(request.timeoutInterval == 10)
        }
        #expect(throws: AuthFailure.self) { try controller.useServer(check) }
    }

    @Test("whenAddressIsNotPenny_AuthController_ShouldExplainWhatToCheck")
    func checkServerFailures() async {
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/info": Routes.json(#"{"name":"other","version":"1"}"#)]))
        do {
            _ = try await controller.checkServer("https://penny.example.test")
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .notAPennyServer)
        }
        let down = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/info": Routes.fail(.cannotConnectToHost)]))
        do {
            _ = try await down.checkServer("https://penny.example.test")
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .unreachable)
        }
        await #expect(throws: AuthFailure.self) { try await down.checkServer("penny.example.test") }
        await #expect(throws: AuthFailure.self) { try await down.checkServer("https://u:p@penny.example.test") }
    }

    @Test("whenSingleSignOnIsOffOrItsCheckFails_AuthController_ShouldSaySoOrNotKnow")
    func checkServerWithoutOidc() async throws {
        let off = AuthFixtures.controller(
            transport: Routes.transport([
                "GET /api/info": Routes.json(AuthFixtures.info),
                "GET /api/auth/oidc": Routes.json(#"{"enabled":false}"#),
            ]))
        let check = try await off.checkServer("http://localhost:3001")
        #expect(check.singleSignOn == false)
        #expect(!check.isEncrypted)
        // A 404 is an ordinary failure: the server did not say.
        let missing = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/info": Routes.json(AuthFixtures.info)]))
        #expect(try await missing.checkServer("http://localhost:3001").singleSignOn == nil)
    }

    @Test("whenUsingANewServerAfterExpiry_AuthController_ShouldSaveItAndDropTheOldNotice")
    func useServer() async throws {
        let preferences = EphemeralAuthPreferences(server: SavedServer(server: AuthFixtures.server))
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/me": Routes.json(401, "{}")]),
            sessions: EphemeralSessionStore([APIFixtures.session()]), preferences: preferences)
        await controller.restore()
        #expect(controller.state == .signedOut(.sessionExpired(email: email)))
        let check = ServerCheck(
            server: APIFixtures.otherServer, version: "2.0.0", singleSignOn: true, singleSignOnLabel: "Company ID")
        try controller.useServer(check)
        #expect(controller.state == .signedOut(nil))
        #expect(preferences.savedServer() == SavedServer(server: APIFixtures.otherServer, version: "2.0.0"))
        #expect(controller.singleSignOn == .available(label: "Company ID"))
    }

    @Test("whenLoadingSingleSignOn_AuthController_ShouldReportAvailabilityAndFailures")
    func refreshSingleSignOn() async {
        let available = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/oidc": Routes.json(#"{"enabled":true}"#)]))
        await available.restore()
        await available.refreshSingleSignOn()
        #expect(available.singleSignOn == .available(label: "single sign-on"))

        let off = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/oidc": Routes.json(#"{"enabled":false}"#)]))
        await off.restore()
        await off.refreshSingleSignOn()
        #expect(off.singleSignOn == .unavailable)

        let failing = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/auth/oidc": Routes.fail(.notConnectedToInternet)]))
        await failing.restore()
        await failing.refreshSingleSignOn()
        #expect(failing.singleSignOn == .failed)

        let missing = AuthFixtures.controller(transport: Routes.transport([:]))
        await missing.restore()
        await missing.refreshSingleSignOn()
        #expect(missing.singleSignOn == .failed, "a 404 is an ordinary failure")
    }
}
