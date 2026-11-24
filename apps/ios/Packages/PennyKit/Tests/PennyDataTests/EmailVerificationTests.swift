import Foundation
import PennyData
import PennyDomain
import Testing

/// MAZ-172: the profile's verification state, Check your email after sign-up, Resend and Change
/// email (which moves the account and its local data to the new address).
@Suite("Email verification")
@MainActor
struct EmailVerificationTests {
    private let email = "bea@example.test"
    private let newEmail = "bea.new@example.test"
    private let emailOn = SavedServer(server: AuthFixtures.server, emailEnabled: true)

    private func profileJSON(_ address: String, verified: Bool) -> String {
        #"{"userId":"u1","email":"\#(address)","nameEditable":true,"avatarEditable":true,"needsName":false,"signIn":"password","emailVerified":\#(verified)}"#
    }

    // MARK: Wire model

    @Test("whenDecodingAProfile_WireProfile_ShouldReadVerificationAndTreatOlderServersAsVerified")
    func decoding() throws {
        let unverified = try JSONDecoder().decode(
            WireProfile.self, from: Data(profileJSON(email, verified: false).utf8))
        #expect(unverified.emailVerified == false)
        #expect(unverified.emailVerifiedAt == nil)
        let verified = try JSONDecoder().decode(
            WireProfile.self,
            from: Data(
                #"{"userId":"u1","email":"a@example.test","nameEditable":true,"avatarEditable":true,"needsName":false,"signIn":"password","emailVerified":true,"emailVerifiedAt":1800000000000}"#
                    .utf8))
        #expect(verified.emailVerified)
        #expect(verified.emailVerifiedAt == 1_800_000_000_000)
        let older = try JSONDecoder().decode(
            WireProfile.self,
            from: Data(
                #"{"userId":"u1","email":"a@example.test","nameEditable":true,"avatarEditable":true,"needsName":false,"signIn":"password"}"#
                    .utf8))
        #expect(older.emailVerified, "a server before verification never asks for it")
    }

    @Test("whenAProfileIsLoaded_ProfileModel_ShouldAwaitVerificationOnlyForUnverifiedPasswordAccounts")
    func awaitsVerification() async {
        let service = FakeProfiles()
        let model = ProfileModel(service: service)
        #expect(!model.awaitsVerification, "nothing loaded")
        service.profile = WireProfile(userId: "u1", email: email, emailVerified: false)
        await model.refresh()
        #expect(model.awaitsVerification)
        service.profile = WireProfile(userId: "u1", email: email, signIn: "oidc", emailVerified: false)
        await model.refresh()
        #expect(!model.awaitsVerification, "a provider account has no link to resend")
        model.adopt(WireProfile(userId: "u1", email: email, emailVerified: true))
        #expect(!model.awaitsVerification)
    }

    // MARK: API

    @Test("whenVerifyingALink_APIClient_ShouldSendTheCodeWithoutASessionAndRefuseAMalformedOne")
    func verifyRequest() async throws {
        let transport = Routes.transport([
            "POST /api/auth/email-verification": Routes.json(#"{"email":"bea@example.test"}"#)
        ])
        let client = APIClient.anonymous(APIConfiguration(server: AuthFixtures.server), transport: transport)
        let code = String(repeating: "ab", count: 32)
        #expect(try await client.verifyEmail(token: code).email == email)
        let request = try #require(transport.sent.last)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(try APIFixtures.object(request.httpBody)["token"] as? String == code)
        await #expect(throws: APIError.self) { _ = try await client.verifyEmail(token: "ABC") }
        #expect(transport.sent.count == 1, "a malformed code is never sent")
    }

    @Test("whenALinkIsInvalidOrExpired_APIClient_ShouldReportTheServersMessage")
    func verifyRefused() async throws {
        let transport = Routes.transport([
            "POST /api/auth/email-verification": Routes.json(
                400, #"{"error":"This verification link is invalid or has expired."}"#)
        ])
        let client = APIClient.anonymous(APIConfiguration(server: AuthFixtures.server), transport: transport)
        do {
            _ = try await client.verifyEmail(token: String(repeating: "ab", count: 32))
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error == .badRequest(message: "This verification link is invalid or has expired."))
        }
    }

    // MARK: Check your email

    @Test("whenSigningUpOnAServerThatSendsEmail_AuthController_ShouldShowCheckEmailUntilContinue")
    func checkEmailAfterSignUp() async throws {
        let transport = Routes.transport(["POST /api/auth/register": Routes.json(Routes.session(email))])
        let controller = AuthFixtures.controller(
            transport: transport, preferences: EphemeralAuthPreferences(server: emailOn))
        await controller.restore()
        try await controller.register(email: email, password: "long enough pass")
        #expect(controller.showsCheckEmail)
        #expect(controller.verificationEmailSentAt == Date(timeIntervalSince1970: 1_800_000_000))
        controller.continueAfterCheckEmail()
        #expect(!controller.showsCheckEmail)
    }

    @Test("whenSigningUpWithoutEmailOrSigningIn_AuthController_ShouldNotShowCheckEmail")
    func noCheckEmail() async throws {
        let transport = Routes.transport([
            "POST /api/auth/register": Routes.json(Routes.session(email)),
            "POST /api/auth/login": Routes.json(Routes.session(email)),
        ])
        let off = AuthFixtures.controller(transport: transport)
        await off.restore()
        try await off.register(email: email, password: "long enough pass")
        #expect(!off.showsCheckEmail, "verification is off without email")

        let on = AuthFixtures.controller(transport: transport, preferences: EphemeralAuthPreferences(server: emailOn))
        await on.restore()
        try await on.signIn(email: email, password: "long enough pass")
        #expect(!on.showsCheckEmail, "only a new account sees it")
    }

    // MARK: Resend

    @Test("whenResending_AuthController_ShouldSendWithTheSessionAndRestartTheCountdown")
    func resend() async throws {
        let transport = Routes.transport([
            "POST /api/auth/login": Routes.json(Routes.session(email)),
            "POST /api/auth/email-verification/resend": Routes.json(202, #"{"ok":true}"#),
        ])
        let controller = AuthFixtures.controller(
            transport: transport, preferences: EphemeralAuthPreferences(server: emailOn))
        await controller.restore()
        try await controller.signIn(email: email, password: "long enough pass")
        #expect(controller.verificationEmailSentAt == nil)
        #expect(await controller.resendVerificationEmail() == nil)
        #expect(controller.verificationEmailSentAt != nil)
        let request = try #require(transport.sent.last)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
    }

    @Test("whenTheServerStoppedSendingEmail_AuthController_ShouldSayItAndForgetEmail")
    func resendEmailOff() async throws {
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": Routes.json(Routes.session(email)),
                "POST /api/auth/email-verification/resend": Routes.json(
                    404, #"{"error":"This server doesn't send email."}"#),
            ]), preferences: EphemeralAuthPreferences(server: emailOn))
        await controller.restore()
        try await controller.signIn(email: email, password: "long enough pass")
        #expect(await controller.resendVerificationEmail() == "This server doesn't send email.")
        #expect(controller.server?.emailEnabled == false)
    }

    @Test("whenResendingTooOften_AuthController_ShouldSayToWait")
    func resendLimited() async throws {
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": Routes.json(Routes.session(email)),
                "POST /api/auth/email-verification/resend": Routes.json(429, #"{"error":"Too many"}"#),
            ]), preferences: EphemeralAuthPreferences(server: emailOn))
        await controller.restore()
        try await controller.signIn(email: email, password: "long enough pass")
        #expect(await controller.resendVerificationEmail() == "Too many attempts. Wait a few minutes and try again.")
    }

    @Test("whenTheSessionExpiredWhileResending_AuthController_ShouldSignOut")
    func resendExpired() async throws {
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": Routes.json(Routes.session(email)),
                "POST /api/auth/email-verification/resend": Routes.json(401, #"{"error":"Unauthorized"}"#),
            ]))
        await controller.restore()
        try await controller.signIn(email: email, password: "long enough pass")
        _ = await controller.resendVerificationEmail()
        #expect(controller.state == .signedOut(.sessionExpired(email: email)))
    }

    // MARK: Change email

    @Test("whenChangingEmail_AuthController_ShouldMoveTheAccountAndItsLocalDataToTheNewAddress")
    func changeEmail() async throws {
        let log = CallLog()
        let local = FakeLocalData(log: log)
        let sessions = EphemeralSessionStore()
        let transport = Routes.transport([
            "POST /api/auth/register": Routes.json(Routes.session(email)),
            "POST /api/auth/email": Routes.json(profileJSON(newEmail, verified: false)),
        ])
        let controller = AuthFixtures.controller(
            transport: transport, sessions: sessions, preferences: EphemeralAuthPreferences(server: emailOn),
            localData: local, log: log)
        await controller.restore()
        try await controller.register(email: email, password: "long enough pass")
        let outcome = await controller.changeEmail(to: "  \(newEmail) ", password: "long enough pass")
        guard case .changed(let profile) = outcome else {
            Issue.record("expected a change, got \(outcome)")
            return
        }
        #expect(profile.email == newEmail)
        #expect(!profile.emailVerified)
        #expect(log.all.contains("move \(email) -> \(newEmail)"))
        #expect(controller.state.account?.email == newEmail)
        #expect(try sessions.load(server: AuthFixtures.server)?.email == newEmail)
        #expect(controller.showsCheckEmail, "Check your email follows the account to its new address")
        let body = try APIFixtures.object(transport.sent.last?.httpBody)
        #expect(body["email"] as? String == newEmail)
        #expect(body["password"] as? String == "long enough pass")
    }

    @Test(
        "whenTheServerRefusesAnEmailChange_AuthController_ShouldSayWhichFieldIsWrongAndKeepTheAccount",
        arguments: [
            (409, #"{"error":"Another account already uses this email."}"#, "email"),
            (400, #"{"error":"Enter a valid email address."}"#, "email"),
            (400, #"{"error":"Your current password is incorrect."}"#, "password"),
            (403, #"{"error":"Your sign-in provider manages your email. Change it with your provider."}"#, "failed"),
        ])
    func changeRefused(status: Int, body: String, field: String) async throws {
        let log = CallLog()
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": Routes.json(Routes.session(email)),
                "POST /api/auth/email": Routes.json(status, body),
            ]), localData: FakeLocalData(log: log), log: log)
        await controller.restore()
        try await controller.signIn(email: email, password: "long enough pass")
        let outcome = await controller.changeEmail(to: newEmail, password: "long enough pass")
        switch (outcome, field) {
        case (.invalidEmail, "email"), (.wrongPassword, "password"), (.failed, "failed"): break
        default: Issue.record("unexpected \(outcome) for \(field)")
        }
        #expect(controller.state.account?.email == email)
        #expect(!log.all.contains { $0.hasPrefix("move") })
    }

    @Test("whenTheNewEmailOrPasswordIsMissing_AuthController_ShouldRefuseBeforeSending")
    func changeValidation() async throws {
        let transport = Routes.transport(["POST /api/auth/login": Routes.json(Routes.session(email))])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        try await controller.signIn(email: email, password: "long enough pass")
        let sent = transport.sent.count
        #expect(
            await controller.changeEmail(to: "not an email", password: "x")
                == .invalidEmail("Enter a valid email address."))
        #expect(await controller.changeEmail(to: newEmail, password: "") == .wrongPassword("Enter your password."))
        #expect(transport.sent.count == sent)
    }

    @Test("whenLocalDataCannotMove_AuthController_ShouldKeepTheStoredScopeForTheNextLaunch")
    func changeMoveFails() async throws {
        let local = FakeLocalData()
        local.moveError.withLock { $0 = URLError(.cannotWriteToFile) }
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/login": Routes.json(Routes.session(email)),
                "POST /api/auth/email": Routes.json(profileJSON(newEmail, verified: false)),
            ]), localData: local)
        await controller.restore()
        try await controller.signIn(email: email, password: "long enough pass")
        guard case .changed = await controller.changeEmail(to: newEmail, password: "long enough pass") else {
            Issue.record("the server changed the email")
            return
        }
        #expect(controller.state.account?.email == email, "the launch-time check moves it later")
    }
}
