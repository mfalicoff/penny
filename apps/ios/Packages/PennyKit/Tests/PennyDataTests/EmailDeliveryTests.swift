import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

/// MAZ-124: `emailEnabled`, password reset by email and with a code, and invitations by email.
/// Fixture addresses on `.test` domains only.
@Suite("Email delivery: password reset and invitations by email")
@MainActor
struct EmailDeliveryTests {
    static let code = String(repeating: "ab", count: 32)

    // MARK: emailEnabled

    @Test("whenServerInfoHasNoOrFalseOrTrueEmailEnabled_WireServerInfo_ShouldSendEmailOnlyWhenTrue")
    func infoDecoding() throws {
        func decode(_ json: String) throws -> WireServerInfo {
            try JSONDecoder().decode(WireServerInfo.self, from: Data(json.utf8))
        }
        #expect(try decode(#"{"name":"penny","version":"2"}"#).sendsEmail == false, "older servers send no email")
        #expect(try decode(#"{"name":"penny","version":"2","emailEnabled":false}"#).sendsEmail == false)
        #expect(try decode(#"{"name":"penny","version":"2","emailEnabled":true}"#).sendsEmail == true)
    }

    @Test("whenSavingTheServer_SavedServer_ShouldKeepEmailEnabledAndDefaultToOff")
    func savedServer() throws {
        let saved = SavedServer(server: AuthFixtures.server, version: "2", emailEnabled: true)
        #expect(try JSONDecoder().decode(SavedServer.self, from: try JSONEncoder().encode(saved)) == saved)
        let older = try JSONDecoder().decode(
            SavedServer.self, from: Data(#"{"url":"https://penny.example.test"}"#.utf8))
        #expect(older.emailEnabled == false)
    }

    @Test("whenCheckingAndRefreshingTheServer_AuthController_ShouldFollowEmailEnabled")
    func checkAndRefresh() async throws {
        let answer = Mutex(#"{"name":"penny","version":"2.0.0","emailEnabled":true}"#)
        let preferences = EphemeralAuthPreferences()
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "GET /api/info": { _ in HTTPResult(status: 200, body: Data(answer.withLock { $0 }.utf8)) }
            ]), preferences: preferences)
        await controller.restore()
        let check = try await controller.checkServer("https://penny.example.test")
        #expect(check.emailEnabled)
        try controller.useServer(check)
        #expect(controller.server?.emailEnabled == true)
        #expect(preferences.savedServer()?.emailEnabled == true)
        answer.withLock { $0 = #"{"name":"penny","version":"2.0.0"}"# }
        await controller.refreshServerInfo()
        #expect(controller.server?.emailEnabled == false, "email turned off")
        answer.withLock { $0 = #"{"name":"other"}"# }
        await controller.refreshServerInfo()
        #expect(controller.server?.emailEnabled == false, "a failed read changes nothing")
    }

    // MARK: Password reset

    @Test("whenAskingForAResetEmail_AuthController_ShouldSendTheTrimmedAddressAndReportSent")
    func requestSent() async throws {
        let transport = Routes.transport(["POST /api/auth/password-reset/request": Routes.json(202, #"{"ok":true}"#)])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        #expect(try await controller.requestPasswordReset(email: "  bea@example.test ") == .sent)
        let request = try #require(transport.sent.last)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil, "no session is sent")
        #expect(try APIFixtures.object(request.httpBody)["email"] as? String == "bea@example.test")
    }

    @Test("whenTheServerStoppedSendingEmail_AuthController_ShouldReportEmailOffAndForgetIt")
    func requestEmailOff() async throws {
        let preferences = EphemeralAuthPreferences(server: SavedServer(server: AuthFixtures.server, emailEnabled: true))
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "POST /api/auth/password-reset/request": Routes.json(
                    404, #"{"error":"This server doesn't send email."}"#)
            ]), preferences: preferences)
        await controller.restore()
        #expect(try await controller.requestPasswordReset(email: "bea@example.test") == .emailOff)
        #expect(controller.server?.emailEnabled == false)
        #expect(preferences.savedServer()?.emailEnabled == false)
    }

    @Test(
        "whenAResetRequestFails_AuthController_ShouldSayWhatToDo",
        arguments: [
            ("not an email", nil, AuthFailure.Kind.invalidInput),
            ("bea@example.test", 429, .rateLimited),
            ("bea@example.test", 500, .server),
        ] as [(String, Int?, AuthFailure.Kind)])
    func requestFailures(email: String, status: Int?, kind: AuthFailure.Kind) async {
        let transport = Routes.transport([
            "POST /api/auth/password-reset/request": Routes.json(status ?? 202, #"{"error":"Nope."}"#)
        ])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        await #expect(throws: AuthFailure.self) { _ = try await controller.requestPasswordReset(email: email) }
        do {
            _ = try await controller.requestPasswordReset(email: email)
        } catch {
            #expect(error.kind == kind)
        }
        if status == nil { #expect(transport.sent.isEmpty, "an invalid address is never sent") }
    }

    @Test("whenResettingWithAValidCode_AuthController_ShouldSendItLowercasedAndSaySignInAgain")
    func resetSucceeds() async throws {
        let transport = Routes.transport(["POST /api/auth/password-reset": Routes.json(#"{"ok":true}"#)])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        let pasted = " " + Self.code.prefix(32).uppercased() + "\n" + Self.code.suffix(32) + " "
        try await controller.resetPassword(code: pasted, password: "a new long password")
        let body = try APIFixtures.object(transport.sent.last?.httpBody)
        #expect(body["token"] as? String == Self.code)
        #expect(body["password"] as? String == "a new long password")
        #expect(controller.state == .signedOut(.passwordReset))
    }

    @Test("whenTheResetCodeIsMalformedOrRefused_AuthController_ShouldSayTheCodeIsWrong")
    func resetCodeRefused() async {
        let transport = Routes.transport([
            "POST /api/auth/password-reset": Routes.json(
                400, #"{"error":"This reset code is invalid or has expired."}"#)
        ])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        do {
            try await controller.resetPassword(code: "1234", password: "a new long password")
            Issue.record("a short code was accepted")
        } catch {
            #expect(error.kind == .invalidCode)
            #expect(error.message == PasswordResetCode.invalidFormat)
        }
        #expect(transport.sent.isEmpty, "a malformed code is never sent")
        do {
            try await controller.resetPassword(code: Self.code, password: "a new long password")
            Issue.record("a refused code succeeded")
        } catch {
            #expect(error.kind == .invalidCode)
            #expect(error.message == "This reset code is invalid or has expired.")
        }
        #expect(controller.state == .signedOut(nil))
    }

    @Test("whenTheNewPasswordIsTooShort_AuthController_ShouldNotSendIt")
    func resetShortPassword() async {
        let transport = Routes.transport(["POST /api/auth/password-reset": Routes.json(#"{"ok":true}"#)])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        await #expect(throws: AuthFailure(.invalidInput, "Use a password of 10–256 characters.")) {
            try await controller.resetPassword(code: Self.code, password: "short")
        }
        #expect(transport.sent.isEmpty)
    }

    // MARK: Invitations by email

    @Test("whenSendingResendingAndCancelling_EmailInvitesModel_ShouldKeepTheListInStep")
    func invites() async throws {
        let fake = FakeHouseholds.standard()
        let model = EmailInvitesModel(householdId: FakeHouseholds.home, service: fake)
        await model.refresh()
        #expect(model.load == .loaded)
        #expect(model.invites.isEmpty)
        let sent = try await model.send(to: " Sam@Example.test ").get()
        #expect(sent.email == "sam@example.test")
        _ = try await model.send(to: "jo@example.test").get()
        #expect(model.invites.map(\.email) == ["jo@example.test", "sam@example.test"])
        _ = try await model.send(to: "sam@example.test").get()
        #expect(model.invites.map(\.email) == ["sam@example.test", "jo@example.test"], "sending again moves it up")
        #expect(await model.resend(model.invites[1]) == nil)
        #expect(await model.revoke(model.invites[0]) == nil)
        #expect(model.invites.map(\.email) == ["jo@example.test"])
    }

    @Test("whenAnInvitationEmailFails_EmailInvitesModel_ShouldSayWhy")
    func inviteFailures() async throws {
        let fake = FakeHouseholds.standard()
        let model = EmailInvitesModel(householdId: FakeHouseholds.home, service: fake)
        #expect(await model.send(to: "nope").failure?.kind == .invalid)
        #expect(fake.state.withLock { $0.calls }.isEmpty, "an invalid address is never sent")

        fake.state.withLock { $0.failNext["sendEmailInvite"] = .rateLimited(retryAfter: nil) }
        let limited = await model.send(to: "sam@example.test").failure
        #expect(limited?.message == "Too many invitation emails today. Try again tomorrow, or share a code instead.")

        fake.state.withLock {
            $0.failNext["sendEmailInvite"] = .forbidden(message: "Only the household creator can manage members.")
        }
        #expect(
            await model.send(to: "sam@example.test").failure?.message
                == "Only the household creator can manage members.")

        let invite = try await model.send(to: "sam@example.test").get()
        fake.state.withLock {
            $0.failNext["resendEmailInvite"] = .conflict(message: "They already joined with this invitation.")
        }
        #expect(await model.resend(invite)?.message == "They already joined with this invitation.")
        fake.state.withLock { $0.failNext["revokeEmailInvite"] = .notFound(message: "Invitation not found.") }
        #expect(await model.revoke(invite)?.kind == .gone)
        #expect(model.invites.isEmpty, "a row revoked elsewhere leaves the list")
        #expect(model.emailOff == false)

        fake.state.withLock { $0.failNext["emailInvites"] = .notFound(message: "This server doesn't send email.") }
        await model.refresh()
        #expect(model.emailOff, "the sheet falls back to the shared code")
    }

    @Test("whenDescribingAnInvitation_EmailInviteText_ShouldSayWhenItWasSentAndWhatBecameOfIt")
    func inviteText() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let locale = Locale(identifier: "en_US_POSIX")
        let now = Date(timeIntervalSince1970: 1_795_392_000)  // 2026-11-23 00:00 UTC
        let today = Int64(now.addingTimeInterval(9 * 3600 + 38 * 60).timeIntervalSince1970 * 1000)
        let earlier = Int64(now.addingTimeInterval(-5 * 86_400).timeIntervalSince1970 * 1000)
        func detail(_ status: WireEmailInvite.Status, sentAt: Int64?) -> String {
            EmailInviteText.detail(
                WireEmailInvite(id: "i", email: "jo@example.test", status: status, createdAt: 0, sentAt: sentAt),
                now: now.addingTimeInterval(10 * 3600), calendar: calendar, locale: locale)
        }
        #expect(detail(.waiting, sentAt: today).hasPrefix("Sent today at 9:38"))
        #expect(detail(.expired, sentAt: earlier) == "Sent Nov 18 · link expired")
        #expect(detail(.sending, sentAt: nil) == "Sending now")
        #expect(detail(.failed, sentAt: earlier).hasPrefix("Couldn't be delivered"))
        #expect(EmailInviteText.status(.waiting) == "Waiting")
        let unknown = try? JSONDecoder().decode(
            WireEmailInvite.self,
            from: Data(
                #"{"id":"i","email":"jo@example.test","status":"bounced","createdAt":0,"sentAt":null,"expiresAt":null}"#
                    .utf8))
        #expect(unknown?.status == .sending, "a newer status never breaks the list")
    }

    @Test("whenCallingTheEmailInviteEndpoints_APIClient_ShouldUseTheContractPaths")
    func invitePaths() async throws {
        let invite =
            #"{"id":"inv-1","email":"sam@example.test","status":"waiting","createdAt":1,"sentAt":2,"expiresAt":3}"#
        let transport = Routes.transport([
            "GET /api/households/house-1/email-invites": Routes.json(#"{"items":[\#(invite)]}"#),
            "POST /api/households/house-1/email-invites": Routes.json(202, invite),
            "POST /api/households/house-1/email-invites/inv-1/resend": Routes.json(202, invite),
            "DELETE /api/households/house-1/email-invites/inv-1": Routes.json(#"{"ok":true}"#),
        ])
        let client = try APIFixtures.client(transport: transport)
        #expect(try await client.emailInvites(householdId: "house-1").map(\.id) == ["inv-1"])
        _ = try await client.sendEmailInvite(householdId: "house-1", email: " sam@example.test ")
        #expect(try APIFixtures.object(transport.sent.last?.httpBody)["email"] as? String == "sam@example.test")
        #expect(try await client.resendEmailInvite(householdId: "house-1", inviteId: "inv-1").status == .waiting)
        try await client.revokeEmailInvite(householdId: "house-1", inviteId: "inv-1")
        await #expect(throws: APIError.invalidRequest(.invalidField("inviteId"))) { () async throws in
            try await client.revokeEmailInvite(householdId: "house-1", inviteId: "")
        }
    }
}

extension Result {
    fileprivate var failure: Failure? {
        if case .failure(let failure) = self { return failure }
        return nil
    }
}
