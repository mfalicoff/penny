import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

@Suite("Single sign-on")
@MainActor
struct SingleSignOnTests {
    private let email = "contract-user@example.test"

    /// `serverDate` is the start response's `Date` header: the server's clock.
    private func routes(
        complete: Routes.Answer? = nil, challenge: String = AuthFixtures.challenge(),
        serverDate: String? = AuthFixtures.serverDate
    ) -> StubTransport {
        Routes.transport([
            "POST /api/auth/oidc/start": Routes.json(200, challenge, headers: serverDate.map { ["date": $0] } ?? [:]),
            "POST /api/auth/oidc/complete": complete ?? Routes.json(Routes.session("contract-user@example.test")),
        ])
    }

    @Test("whenProviderReturnsTheCallback_SingleSignOn_ShouldRedeemItOnceAndSignIn")
    func success() async throws {
        let transport = routes()
        let sessions = EphemeralSessionStore()
        let controller = AuthFixtures.controller(transport: transport, sessions: sessions)
        await controller.restore()
        let authenticator = FakeAuthenticator.callback()
        #expect(try await controller.signInWithSingleSignOn(using: authenticator) == .signedIn)
        #expect(controller.state.account?.email == email)
        #expect(try sessions.load(server: AuthFixtures.server) != nil)
        #expect(
            authenticator.opened.withLock { $0 } == [try #require(URL(string: "https://id.example.test/authorize"))])

        let start = try APIFixtures.object(transport.sent[0].httpBody)
        #expect(start["redirectUri"] as? String == "penny://auth/callback")
        let complete = try APIFixtures.object(transport.sent[1].httpBody)
        #expect(complete["transaction"] as? String == AuthFixtures.transaction)
        #expect(complete["callbackUrl"] as? String == "penny://auth/callback?state=s1&code=c1")
        #expect(transport.sent.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
    }

    @Test("whenPersonClosesTheSheet_SingleSignOn_ShouldReturnCancelledAndRedeemNothing")
    func cancelled() async throws {
        let transport = routes()
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        let outcome = try await controller.signInWithSingleSignOn(
            using: FakeAuthenticator { _ in throw CancellationError() })
        #expect(outcome == .cancelled)
        #expect(controller.state == .signedOut(nil))
        #expect(transport.paths() == ["POST /api/auth/oidc/start"])
        // A new attempt can start right away.
        #expect(try await controller.signInWithSingleSignOn(using: FakeAuthenticator.callback()) == .signedIn)
    }

    @Test("whenPersonDeclinesAtTheProvider_SingleSignOn_ShouldReturnCancelled")
    func declined() async throws {
        let controller = AuthFixtures.controller(
            transport: routes(complete: Routes.json(401, #"{"error":"Sign-in could not be verified."}"#)))
        await controller.restore()
        let outcome = try await controller.signInWithSingleSignOn(
            using: FakeAuthenticator.callback("state=s1&error=access_denied"))
        #expect(outcome == .cancelled)
        #expect(controller.state == .signedOut(nil))
    }

    @Test("whenSameCallbackArrivesAgain_SingleSignOn_ShouldRefuseTheReplayWithoutContactingTheServer")
    func replay() async throws {
        let transport = routes(complete: Routes.json(401, #"{"error":"Sign-in could not be verified."}"#))
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        let callback = FakeAuthenticator.callback()
        await #expect(throws: AuthFailure(.singleSignOnRejected, "Sign-in could not be verified.")) {
            try await controller.signInWithSingleSignOn(using: callback)
        }
        await #expect(
            throws: AuthFailure(.callbackRejected, "This sign-in response was not accepted. Please try again.")
        ) {
            try await controller.signInWithSingleSignOn(using: callback)
        }
        #expect(transport.paths().filter { $0 == "POST /api/auth/oidc/complete" }.count == 1)
        #expect(controller.state == .signedOut(nil))
    }

    @Test("whenCallbackIsNotPennysRedirect_SingleSignOn_ShouldRefuseIt")
    func foreignCallback() async throws {
        for text in [
            "penny://evil/callback?state=s1", "penny://auth/callback?code=c1", "penny://auth/callback?state=a&state=b",
            "https://penny.example.test/auth/callback?state=s1", "penny://auth/callback?state=s1#frag",
        ] {
            let transport = routes()
            let controller = AuthFixtures.controller(transport: transport)
            await controller.restore()
            let authenticator = FakeAuthenticator { _ in
                guard let url = URL(string: text) else { throw URLError(.badURL) }
                return url
            }
            do {
                _ = try await controller.signInWithSingleSignOn(using: authenticator)
                Issue.record("accepted \(text)")
            } catch {
                #expect(error.kind == .callbackRejected)
            }
            #expect(!transport.paths().contains("POST /api/auth/oidc/complete"))
        }
    }

    @Test("whenAttemptAlreadyExpired_SingleSignOn_ShouldNotOpenTheProvider")
    func expired() async throws {
        let controller = AuthFixtures.controller(transport: routes(challenge: AuthFixtures.challenge(expiresAt: 1000)))
        await controller.restore()
        let authenticator = FakeAuthenticator.callback()
        await #expect(throws: AuthFailure(.singleSignOnExpired, "Sign-in expired. Please try again.")) {
            try await controller.signInWithSingleSignOn(using: authenticator)
        }
        #expect(authenticator.opened.withLock { $0 }.isEmpty)
    }

    @Test("whenAttemptExpiresWhileTheSheetIsOpen_SingleSignOn_ShouldNotRedeemIt")
    func expiresDuringSheet() async throws {
        // The attempt is valid at 1_800_000_000 s and expires 5 s later; the sheet takes longer.
        let clock = Clock(1_800_000_000)
        let transport = routes(challenge: AuthFixtures.challenge(expiresAt: 1_800_000_005_000))
        let controller = AuthController(
            defaultServer: AuthFixtures.server, sessions: EphemeralSessionStore(),
            preferences: EphemeralAuthPreferences(), transport: transport, now: { clock.now })
        await controller.restore()
        let authenticator = FakeAuthenticator { _ in
            clock.advance(60)
            guard let url = URL(string: "penny://auth/callback?state=s1&code=c1") else { throw URLError(.badURL) }
            return url
        }
        await #expect(throws: AuthFailure(.singleSignOnExpired, "Sign-in expired. Please try again.")) {
            try await controller.signInWithSingleSignOn(using: authenticator)
        }
        #expect(!transport.paths().contains("POST /api/auth/oidc/complete"))
    }

    @Test("whenDeviceClockIsFast_SingleSignOn_ShouldMeasureTheAttemptOnTheServersClockAndSignIn")
    func deviceClockFast() async throws {
        // The device is an hour ahead; the server gives the attempt 10 minutes from its own clock.
        let clock = Clock(1_800_003_600)
        let transport = routes(challenge: AuthFixtures.challenge(expiresAt: 1_800_000_600_000))
        let controller = AuthController(
            defaultServer: AuthFixtures.server, sessions: EphemeralSessionStore(),
            preferences: EphemeralAuthPreferences(), transport: transport, now: { clock.now })
        await controller.restore()
        let authenticator = FakeAuthenticator { _ in
            clock.advance(120)
            guard let url = URL(string: "penny://auth/callback?state=s1&code=c1") else { throw URLError(.badURL) }
            return url
        }
        #expect(try await controller.signInWithSingleSignOn(using: authenticator) == .signedIn)
        #expect(transport.paths().contains("POST /api/auth/oidc/complete"))
    }

    @Test("whenDeviceClockIsSlow_SingleSignOn_ShouldStillStopAnAttemptTheServerHasForgotten")
    func deviceClockSlow() async throws {
        // The device is an hour behind, so the absolute expiry would look valid for 70 minutes.
        let clock = Clock(1_799_996_400)
        let transport = routes(challenge: AuthFixtures.challenge(expiresAt: 1_800_000_600_000))
        let controller = AuthController(
            defaultServer: AuthFixtures.server, sessions: EphemeralSessionStore(),
            preferences: EphemeralAuthPreferences(), transport: transport, now: { clock.now })
        await controller.restore()
        let authenticator = FakeAuthenticator { _ in
            clock.advance(11 * 60)
            guard let url = URL(string: "penny://auth/callback?state=s1&code=c1") else { throw URLError(.badURL) }
            return url
        }
        await #expect(throws: AuthFailure(.singleSignOnExpired, "Sign-in expired. Please try again.")) {
            try await controller.signInWithSingleSignOn(using: authenticator)
        }
        #expect(!transport.paths().contains("POST /api/auth/oidc/complete"))
    }

    @Test("whenServerSendsNoDate_SingleSignOn_ShouldLeaveExpiryToTheServer")
    func noServerDate() async throws {
        // Without the server's clock the device cannot judge an absolute expiry; the server's
        // own check on complete decides.
        let clock = Clock(1_800_003_600)
        let transport = routes(challenge: AuthFixtures.challenge(expiresAt: 1_800_000_600_000), serverDate: nil)
        let controller = AuthController(
            defaultServer: AuthFixtures.server, sessions: EphemeralSessionStore(),
            preferences: EphemeralAuthPreferences(), transport: transport, now: { clock.now })
        await controller.restore()
        #expect(try await controller.signInWithSingleSignOn(using: FakeAuthenticator.callback()) == .signedIn)
    }

    @Test("whenProviderPageIsNotHTTPS_SingleSignOn_ShouldRefuseToOpenIt")
    func insecureProvider() async throws {
        let controller = AuthFixtures.controller(
            transport: routes(challenge: AuthFixtures.challenge(url: "http://id.example.test/authorize")))
        await controller.restore()
        let authenticator = FakeAuthenticator.callback()
        await #expect(throws: AuthFailure.self) { try await controller.signInWithSingleSignOn(using: authenticator) }
        #expect(authenticator.opened.withLock { $0 }.isEmpty)
        #expect(controller.state == .signedOut(nil))
    }

    @Test("whenServerHasNoSingleSignOn_SingleSignOn_ShouldSayItIsNotConfigured")
    func notConfigured() async throws {
        let controller = AuthFixtures.controller(transport: Routes.transport([:]))
        await controller.restore()
        do {
            _ = try await controller.signInWithSingleSignOn(using: FakeAuthenticator.callback())
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .singleSignOnUnavailable)
        }
    }

    @Test("whenRedirectIsNotConfigured_SingleSignOn_ShouldShowTheServersReason")
    func redirectNotConfigured() async throws {
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/oidc/start": Routes.json(
                    400, #"{"error":"This sign-in redirect is not configured on the server."}"#)
            ]))
        await controller.restore()
        await #expect(
            throws: AuthFailure(.singleSignOnUnavailable, "This sign-in redirect is not configured on the server.")
        ) {
            try await controller.signInWithSingleSignOn(using: FakeAuthenticator.callback())
        }
    }

    @Test("whenStartAnswersAMalformedTransaction_APIClient_ShouldRejectIt")
    func malformedTransaction() async throws {
        let transport = StubTransport(
            json: #"{"transaction":"ABC","authorizationUrl":"https://id.example.test/a","expiresAt":1}"#)
        let client = try APIFixtures.client(session: nil, transport: transport)
        await #expect(throws: APIError.malformedResponse) {
            try await client.startOidc(redirectUri: "penny://auth/callback")
        }
    }

    @Test("whenStartAnswers_APIClient_ShouldReadTheServersClockFromTheDateHeader")
    func startReadsServerDate() async throws {
        let dated = StubTransport(headers: ["date": AuthFixtures.serverDate], json: AuthFixtures.challenge())
        let challenge = try await APIFixtures.client(session: nil, transport: dated)
            .startOidc(redirectUri: "penny://auth/callback")
        #expect(challenge.serverDate == Date(timeIntervalSince1970: 1_800_000_000))
        #expect(challenge.lifetime == 2_302_444_800)

        let garbled = StubTransport(headers: ["date": "yesterday"], json: AuthFixtures.challenge())
        let undated = try await APIFixtures.client(session: nil, transport: garbled)
            .startOidc(redirectUri: "penny://auth/callback")
        #expect(undated.serverDate == nil)
        #expect(undated.lifetime == nil)
    }

    @Test("whenCompletingWithAnOversizedCallback_APIClient_ShouldRefuseBeforeSending")
    func oversizedCallback() async throws {
        let transport = StubTransport(json: "{}")
        let client = try APIFixtures.client(session: nil, transport: transport)
        let long = try #require(URL(string: "penny://auth/callback?state=" + String(repeating: "a", count: 8200)))
        await #expect(throws: APIError.invalidRequest(.invalidField("callbackUrl"))) {
            try await client.completeOidc(transaction: AuthFixtures.transaction, callbackURL: long)
        }
        #expect(transport.sent.isEmpty)
    }
}

/// A settable clock for expiry tests.
final class Clock: Sendable {
    private let seconds: Mutex<TimeInterval>
    init(_ seconds: TimeInterval) { self.seconds = Mutex(seconds) }
    var now: Date { Date(timeIntervalSince1970: seconds.withLock { $0 }) }
    func advance(_ by: TimeInterval) { seconds.withLock { $0 += by } }
}
