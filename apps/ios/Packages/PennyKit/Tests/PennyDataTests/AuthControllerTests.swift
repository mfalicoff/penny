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
        controller.sessionDidExpire(for: scope)
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
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["POST /api/auth/login": Routes.json(Routes.session(email))]))
        await controller.restore()
        try await controller.signIn(email: email, password: "correct horse")
        controller.sessionDidExpire(for: AccountScope(server: AuthFixtures.server, email: "earlier@example.test"))
        controller.sessionDidExpire(for: AccountScope(server: APIFixtures.otherServer, email: email))
        #expect(controller.state.account?.scope == scope)
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
        controller.sessionDidExpire(for: first.scope)
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
        sessions: EphemeralSessionStore = EphemeralSessionStore()
    ) async throws -> (AuthController, StubTransport) {
        var all = routes
        all["POST /api/auth/login"] = Routes.json(Routes.session(email))
        let transport = Routes.transport(all)
        let controller = AuthFixtures.controller(
            transport: transport, sessions: sessions, localData: localData, log: localData.log)
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
        #expect(localData.log.all == ["unregister \(email)", "remove \(email)"])
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
        #expect(localData.log.all.isEmpty)
    }

    @Test("whenSignOutAnyway_AuthController_ShouldDiscardPendingChanges")
    func signOutAnyway() async throws {
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData)
        localData.pending.withLock { $0[scope] = 2 }
        try await controller.signOut(discardingPendingChanges: true)
        #expect(controller.state == .signedOut(.signedOut))
        #expect(localData.log.all.contains("remove \(email)"))
    }

    @Test("whenSyncThenSignOut_AuthController_ShouldSyncFirst")
    func syncThenSignOut() async throws {
        let localData = FakeLocalData()
        let (controller, _) = try await signedIn(
            ["POST /api/auth/logout": Routes.json(#"{"ok":true}"#)], localData: localData)
        localData.pending.withLock { $0[scope] = 2 }
        try await controller.syncThenSignOut()
        #expect(localData.log.all.first == "sync \(email)")
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

        try await controller.signOut(removeEvenIfUnreachable: true)
        #expect(controller.state == .signedOut(.signedOut))
        #expect(try sessions.load(server: AuthFixtures.server) == nil)
    }

    @Test("whenSessionAlreadyEndedOnServer_AuthController_ShouldStillSignOut")
    func signOutAlreadyRevoked() async throws {
        let (controller, _) = try await signedIn(["POST /api/auth/logout": Routes.json(401, "{}")])
        try await controller.signOut()
        #expect(controller.state == .signedOut(.signedOut))
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

    @Test("whenOlderServerHasNoSingleSignOnRoute_AuthController_ShouldReportItUnavailable")
    func checkServerWithoutOidc() async throws {
        let controller = AuthFixtures.controller(
            transport: Routes.transport(["GET /api/info": Routes.json(AuthFixtures.info)]))
        let check = try await controller.checkServer("http://localhost:3001")
        #expect(check.singleSignOn == false)
        #expect(!check.isEncrypted)
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
    }
}
