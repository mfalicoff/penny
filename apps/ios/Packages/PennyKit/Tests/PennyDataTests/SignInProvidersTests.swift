import Foundation
import PennyDomain
import Synchronization
import Testing

@testable import PennyData

/// MAZ-170: several sign-in providers (Google, Apple, the server's own SSO), the browser sign-in
/// for a chosen provider, and the native sign-in (Sign in with Apple).
private let nativeNonce = String(repeating: "ab", count: 32)

@Suite("Sign-in providers")
@MainActor
struct SignInProvidersTests {
    private static let providers = #"""
        {"enabled":true,"label":"Google","providers":[
          {"id":"google","label":"Google","icon":"google","native":false},
          {"id":"apple","label":"Apple","icon":"apple","native":true},
          {"id":"work","label":"Acme SSO","icon":"sso","native":false}]}
        """#

    private static func nativeChallenge(expiresAt: Int64 = 4_102_444_800_000) -> String {
        #"{"transaction":"\#(AuthFixtures.transaction)","nonce":"\#(nativeNonce)","expiresAt":\#(expiresAt)}"#
    }

    private func controller(_ routes: [String: Routes.Answer], now: Clock = Clock(1_800_000_000))
        -> (AuthController, StubTransport)
    {
        let transport = Routes.transport(routes)
        let controller = AuthController(
            defaultServer: AuthFixtures.server, sessions: EphemeralSessionStore(),
            preferences: EphemeralAuthPreferences(), transport: transport, now: { now.now })
        return (controller, transport)
    }

    private var apple: SignInProvider { SignInProvider(id: "apple", label: "Apple", icon: "apple", native: true) }

    // MARK: The list

    @Test("whenServerListsSeveralProviders_AuthController_ShouldOfferEachInItsOrder")
    func several() async {
        let (controller, _) = controller(["GET /api/auth/oidc": Routes.json(Self.providers)])
        await controller.restore()
        await controller.refreshSingleSignOn()
        #expect(
            controller.singleSignOn
                == .available([
                    SignInProvider(id: "google", label: "Google", icon: "google"),
                    SignInProvider(id: "apple", label: "Apple", icon: "apple", native: true),
                    SignInProvider(id: "work", label: "Acme SSO", icon: "sso"),
                ]))
    }

    @Test("whenServerListsNoProviders_AuthController_ShouldOfferNone")
    func none() async {
        let (controller, _) = controller([
            "GET /api/auth/oidc": Routes.json(#"{"enabled":false,"providers":[]}"#)
        ])
        await controller.restore()
        await controller.refreshSingleSignOn()
        #expect(controller.singleSignOn == .unavailable)
    }

    @Test("whenServerIsFromBeforeProviders_SignInProvider_ShouldOfferItsOneSingleSignOn")
    func legacyServer() {
        let list = SignInProvider.list(from: WireOidcConfig(enabled: true, label: " Company ID "))
        #expect(list.map(\.id) == ["sso"])
        #expect(list.map(\.label) == ["Company ID"])
        #expect(list.map(\.mark) == [.other])
        #expect(list.allSatisfy { !$0.sendsID && !$0.native })
        #expect(SignInProvider.list(from: WireOidcConfig(enabled: false)).isEmpty)
    }

    @Test("whenAnEntryIsInvalidOrRepeated_SignInProvider_ShouldLeaveItOut")
    func invalidEntries() {
        let config = WireOidcConfig(
            enabled: true,
            providers: [
                WireOidcProvider(id: "Google", label: "Google", icon: "google"),
                WireOidcProvider(id: "-x", label: "X", icon: "sso"),
                WireOidcProvider(id: String(repeating: "a", count: 33), label: "Long", icon: "sso"),
                WireOidcProvider(id: "blank", label: "  ", icon: "sso"),
                WireOidcProvider(id: "wide", label: String(repeating: "w", count: 61), icon: "sso"),
                WireOidcProvider(id: "google", label: "Google", icon: "google"),
                WireOidcProvider(id: "google", label: "Again", icon: "google"),
                WireOidcProvider(id: "my_sso-2", label: "Mine", icon: "unknown-glyph"),
            ])
        let list = SignInProvider.list(from: config)
        #expect(list.map(\.id) == ["google", "my_sso-2"])
        #expect(list.map(\.mark) == [.google, .other])
        #expect(list.map(\.isBrand) == [true, false])
    }

    @Test("whenCheckingAServerWithProviders_AuthController_ShouldKeepThemForSignIn")
    func checkServer() async throws {
        let (controller, _) = controller([
            "GET /api/info": Routes.json(AuthFixtures.info),
            "GET /api/auth/oidc": Routes.json(Self.providers),
        ])
        await controller.restore()
        let check = try await controller.checkServer("https://penny.example.test")
        #expect(check.providers?.map(\.id) == ["google", "apple", "work"])
        #expect(check.singleSignOn == true)
        try controller.useServer(check)
        #expect(controller.singleSignOn == .available(try #require(check.providers)))
    }

    // MARK: Browser sign-in

    @Test("whenSigningInWithAChosenProvider_SingleSignOn_ShouldStartItByItsId")
    func startsWithProvider() async throws {
        let (controller, transport) = controller([
            "POST /api/auth/oidc/start": Routes.json(
                200, AuthFixtures.challenge(), headers: ["date": AuthFixtures.serverDate]),
            "POST /api/auth/oidc/complete": Routes.json(Routes.session("contract-user@example.test")),
        ])
        await controller.restore()
        let google = SignInProvider(id: "google", label: "Google", icon: "google")
        #expect(
            try await controller.signInWithSingleSignOn(provider: google, using: FakeAuthenticator.callback())
                == .signedIn)
        let start = try APIFixtures.object(transport.sent[0].httpBody)
        #expect(start["provider"] as? String == "google")
        #expect(start["redirectUri"] as? String == "penny://auth/callback")
    }

    @Test("whenTheServerIsFromBeforeProviders_SingleSignOn_ShouldStartWithoutAProvider")
    func legacyStart() async throws {
        let (controller, transport) = controller([
            "POST /api/auth/oidc/start": Routes.json(AuthFixtures.challenge()),
            "POST /api/auth/oidc/complete": Routes.json(Routes.session("contract-user@example.test")),
        ])
        await controller.restore()
        let legacy = try #require(SignInProvider.list(from: WireOidcConfig(enabled: true)).first)
        _ = try await controller.signInWithSingleSignOn(provider: legacy, using: FakeAuthenticator.callback())
        let start = try APIFixtures.object(transport.sent[0].httpBody)
        #expect(start["provider"] == nil)
    }

    @Test("whenPersonCancelsAtApple_SingleSignOn_ShouldReturnCancelled")
    func appleDeclined() async throws {
        let (controller, _) = controller([
            "POST /api/auth/oidc/start": Routes.json(AuthFixtures.challenge()),
            "POST /api/auth/oidc/complete": Routes.json(401, #"{"error":"Sign-in could not be verified."}"#),
        ])
        await controller.restore()
        let outcome = try await controller.signInWithSingleSignOn(
            provider: apple, using: FakeAuthenticator.callback("state=s1&error=user_cancelled_authorize"))
        #expect(outcome == .cancelled)
        #expect(controller.state == .signedOut(nil))
    }

    // MARK: Native sign-in

    @Test("whenAppleReturnsAToken_NativeSignIn_ShouldRedeemItWithTheNameOnceAndSignIn")
    func nativeSuccess() async throws {
        let (controller, transport) = controller([
            "POST /api/auth/oidc/native/start": Routes.json(
                200, Self.nativeChallenge(), headers: ["date": AuthFixtures.serverDate]),
            "POST /api/auth/oidc/native/complete": Routes.json(Routes.session("contract-user@example.test")),
        ])
        await controller.restore()
        let authenticator = FakeNativeAuthenticator { nonce in
            #expect(nonce == nativeNonce)
            return NativeSignInCredential(idToken: "header.payload.signature", givenName: " Robin ", familyName: "Test")
        }
        #expect(try await controller.signInNatively(with: apple, using: authenticator) == .signedIn)
        #expect(controller.state.account?.email == "contract-user@example.test")
        #expect(transport.paths() == ["POST /api/auth/oidc/native/start", "POST /api/auth/oidc/native/complete"])
        let start = try APIFixtures.object(transport.sent[0].httpBody)
        #expect(start["provider"] as? String == "apple")
        let complete = try APIFixtures.object(transport.sent[1].httpBody)
        #expect(complete["transaction"] as? String == AuthFixtures.transaction)
        #expect(complete["idToken"] as? String == "header.payload.signature")
        #expect(complete["givenName"] as? String == "Robin")
        #expect(complete["familyName"] as? String == "Test")
        #expect(transport.sent.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
    }

    @Test("whenAppleSendsNoName_NativeSignIn_ShouldLeaveTheNameOut")
    func nativeWithoutName() async throws {
        let (controller, transport) = controller([
            "POST /api/auth/oidc/native/start": Routes.json(Self.nativeChallenge()),
            "POST /api/auth/oidc/native/complete": Routes.json(Routes.session("contract-user@example.test")),
        ])
        await controller.restore()
        let authenticator = FakeNativeAuthenticator { _ in
            NativeSignInCredential(idToken: "t", givenName: "", familyName: String(repeating: "n", count: 201))
        }
        _ = try await controller.signInNatively(with: apple, using: authenticator)
        let complete = try APIFixtures.object(transport.sent[1].httpBody)
        #expect(complete["givenName"] == nil)
        #expect(complete["familyName"] == nil)
    }

    @Test("whenPersonClosesTheAppleSheet_NativeSignIn_ShouldReturnCancelledAndRedeemNothing")
    func nativeCancelled() async throws {
        let (controller, transport) = controller([
            "POST /api/auth/oidc/native/start": Routes.json(Self.nativeChallenge())
        ])
        await controller.restore()
        let outcome = try await controller.signInNatively(
            with: apple, using: FakeNativeAuthenticator { _ in throw CancellationError() })
        #expect(outcome == .cancelled)
        #expect(controller.state == .signedOut(nil))
        #expect(transport.paths() == ["POST /api/auth/oidc/native/start"])
    }

    @Test("whenAppleFails_NativeSignIn_ShouldExplainAndRedeemNothing")
    func nativeFails() async throws {
        let (controller, transport) = controller([
            "POST /api/auth/oidc/native/start": Routes.json(Self.nativeChallenge())
        ])
        await controller.restore()
        await #expect(throws: AuthFailure(.singleSignOnRejected, "Apple couldn't sign you in. Please try again.")) {
            try await controller.signInNatively(
                with: apple, using: FakeNativeAuthenticator { _ in throw URLError(.unknown) })
        }
        #expect(controller.state == .signedOut(nil))
        #expect(!transport.paths().contains("POST /api/auth/oidc/native/complete"))
    }

    @Test("whenTheServerRefusesTheToken_NativeSignIn_ShouldShowItsReason")
    func nativeRejected() async throws {
        let (controller, _) = controller([
            "POST /api/auth/oidc/native/start": Routes.json(Self.nativeChallenge()),
            "POST /api/auth/oidc/native/complete": Routes.json(401, #"{"error":"Sign-in could not be verified."}"#),
        ])
        await controller.restore()
        await #expect(throws: AuthFailure(.singleSignOnRejected, "Sign-in could not be verified.")) {
            try await controller.signInNatively(
                with: apple, using: FakeNativeAuthenticator { _ in NativeSignInCredential(idToken: "t") })
        }
        #expect(controller.state == .signedOut(nil))
    }

    @Test("whenTheAppleSheetOutlivesTheAttempt_NativeSignIn_ShouldNotRedeemIt")
    func nativeExpires() async throws {
        let clock = Clock(1_800_000_000)
        let (controller, transport) = controller(
            [
                "POST /api/auth/oidc/native/start": Routes.json(
                    200, Self.nativeChallenge(expiresAt: 1_800_000_005_000),
                    headers: ["date": AuthFixtures.serverDate])
            ], now: clock)
        await controller.restore()
        let authenticator = FakeNativeAuthenticator { _ in
            clock.advance(60)
            return NativeSignInCredential(idToken: "t")
        }
        await #expect(throws: AuthFailure(.singleSignOnExpired, "Sign-in expired. Please try again.")) {
            try await controller.signInNatively(with: apple, using: authenticator)
        }
        #expect(!transport.paths().contains("POST /api/auth/oidc/native/complete"))
    }

    @Test("whenProviderIsNotNative_NativeSignIn_ShouldRefuseWithoutContactingTheServer")
    func notNative() async throws {
        let (controller, transport) = controller([:])
        await controller.restore()
        let google = SignInProvider(id: "google", label: "Google", icon: "google")
        do {
            _ = try await controller.signInNatively(
                with: google, using: FakeNativeAuthenticator { _ in NativeSignInCredential(idToken: "t") })
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .singleSignOnUnavailable)
        }
        #expect(transport.sent.isEmpty)
    }

    @Test("whenNativeStartAnswersAMalformedNonce_APIClient_ShouldRejectIt")
    func malformedNonce() async throws {
        let transport = StubTransport(
            json: #"{"transaction":"\#(AuthFixtures.transaction)","nonce":"NOPE","expiresAt":1}"#)
        let client = try APIFixtures.client(session: nil, transport: transport)
        await #expect(throws: APIError.malformedResponse) { try await client.startNativeOidc(provider: "apple") }
    }

    @Test("whenTheTokenIsOversized_APIClient_ShouldRefuseBeforeSending")
    func oversizedToken() async throws {
        let transport = StubTransport(json: "{}")
        let client = try APIFixtures.client(session: nil, transport: transport)
        await #expect(throws: APIError.invalidRequest(.invalidField("idToken"))) {
            try await client.completeNativeOidc(
                transaction: AuthFixtures.transaction, idToken: String(repeating: "a", count: 8193))
        }
        #expect(transport.sent.isEmpty)
    }

    // MARK: Profile

    @Test("whenProfileNamesItsProvider_WireProfile_ShouldReadItsIdAndIcon")
    func profileProvider() throws {
        let json = #"""
            {"userId":"u1","email":"a@example.test","nameEditable":false,"avatarEditable":false,"needsName":false,
             "signIn":"oidc","provider":"Google","providerId":"google","providerIcon":"google","emailVerified":true}
            """#
        let profile = try JSONDecoder().decode(WireProfile.self, from: Data(json.utf8))
        #expect(profile.providerId == "google")
        #expect(profile.providerIcon == "google")
        let again = try JSONDecoder().decode(WireProfile.self, from: JSONEncoder().encode(profile))
        #expect(again == profile)
    }
}

/// Answers the native sign-in with a fixed credential, or throws.
final class FakeNativeAuthenticator: NativeSignInAuthenticator {
    private let answer: @Sendable (String) throws -> NativeSignInCredential
    let nonces = Mutex<[String]>([])

    init(_ answer: @escaping @Sendable (String) throws -> NativeSignInCredential) {
        self.answer = answer
    }

    func authorize(nonce: String) async throws -> NativeSignInCredential {
        nonces.withLock { $0.append(nonce) }
        return try answer(nonce)
    }
}
