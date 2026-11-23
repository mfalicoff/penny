import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

@Suite("Profiles and the privacy policy link")
@MainActor
struct ProfileTests {
    private let email = "contract-user@example.test"

    // MARK: Privacy policy (MAZ-169)

    @Test(
        "whenServerPublishesAPolicy_PrivacyPolicy_ShouldLinkOnlyAbsoluteHTTPURLs",
        arguments: [
            ("https://penny.example.test/privacy", true),
            ("http://localhost:8080/privacy", true),
            ("/privacy", false),
            ("javascript:alert(1)", false),
            ("ftp://penny.example.test/privacy", false),
            ("https://user:secret@penny.example.test/privacy", false),
            ("", false),
        ])
    func policyFilter(text: String, linked: Bool) {
        #expect((PrivacyPolicy.url(text) != nil) == linked)
    }

    @Test("whenServerInfoHasNoOrNullPolicy_WireServerInfo_ShouldDecodeWithoutALink")
    func infoDecoding() throws {
        let older = try JSONDecoder().decode(WireServerInfo.self, from: Data(#"{"name":"penny","version":"2"}"#.utf8))
        #expect(older.privacyPolicy == nil)
        let none = try JSONDecoder().decode(
            WireServerInfo.self, from: Data(#"{"name":"penny","version":"2","privacyPolicyUrl":null}"#.utf8))
        #expect(none.privacyPolicy == nil)
        let set = try JSONDecoder().decode(
            WireServerInfo.self,
            from: Data(#"{"name":"penny","version":"2","privacyPolicyUrl":"https://penny.example.test/privacy"}"#.utf8))
        #expect(set.privacyPolicy?.absoluteString == "https://penny.example.test/privacy")
    }

    @Test("whenSavingTheServer_SavedServer_ShouldKeepThePolicyAndDropABadOne")
    func savedServerRoundTrip() throws {
        let saved = SavedServer(
            server: AuthFixtures.server, version: "2", privacyPolicy: URL(string: "https://penny.example.test/privacy"))
        let decoded = try JSONDecoder().decode(SavedServer.self, from: try JSONEncoder().encode(saved))
        #expect(decoded == saved)
        let bad = try JSONDecoder().decode(
            SavedServer.self,
            from: Data(#"{"url":"https://penny.example.test","privacyPolicyUrl":"javascript:alert(1)"}"#.utf8))
        #expect(bad.privacyPolicy == nil)
        let older = try JSONDecoder().decode(
            SavedServer.self, from: Data(#"{"url":"https://penny.example.test"}"#.utf8))
        #expect(older.privacyPolicy == nil)
    }

    @Test("whenCheckingAndUsingAServer_AuthController_ShouldKeepItsPrivacyPolicy")
    func checkServerKeepsPolicy() async throws {
        let preferences = EphemeralAuthPreferences()
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "GET /api/info": Routes.json(
                    #"{"name":"penny","version":"2.0.0","privacyPolicyUrl":"https://penny.example.test/privacy"}"#)
            ]), preferences: preferences)
        await controller.restore()
        let check = try await controller.checkServer("https://penny.example.test")
        #expect(check.privacyPolicy?.absoluteString == "https://penny.example.test/privacy")
        try controller.useServer(check)
        #expect(controller.server?.privacyPolicy == check.privacyPolicy)
        #expect(preferences.savedServer()?.privacyPolicy == check.privacyPolicy)
    }

    @Test("whenRefreshingServerInfo_AuthController_ShouldFollowThePolicyAndKeepItOnFailure")
    func refreshServerInfo() async {
        let answer = Mutex(#"{"name":"penny","version":"2.0.0","privacyPolicyUrl":"https://penny.example.test/p"}"#)
        let controller = AuthFixtures.controller(
            transport: Routes.transport([
                "GET /api/info": { _ in HTTPResult(status: 200, body: Data(answer.withLock { $0 }.utf8)) }
            ]))
        await controller.restore()
        await controller.refreshServerInfo()
        #expect(controller.server?.privacyPolicy?.absoluteString == "https://penny.example.test/p")
        answer.withLock { $0 = #"{"name":"other"}"# }
        await controller.refreshServerInfo()
        #expect(controller.server?.privacyPolicy?.absoluteString == "https://penny.example.test/p")
        answer.withLock { $0 = #"{"name":"penny","version":"2.0.0","privacyPolicyUrl":null}"# }
        await controller.refreshServerInfo()
        #expect(controller.server?.privacyPolicy == nil)
    }

    // MARK: Sign-up name (MAZ-171)

    @Test("whenRegisteringWithAName_AuthController_ShouldSendTheTrimmedName")
    func registerSendsName() async throws {
        let transport = Routes.transport(["POST /api/auth/register": Routes.json(Routes.session(email))])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        try await controller.register(email: email, password: "long enough pass", displayName: "  Bea Kim ")
        let body = try APIFixtures.object(transport.sent.last?.httpBody)
        #expect(body["displayName"] as? String == "Bea Kim")
        #expect(body["email"] as? String == email)
    }

    @Test("whenRegisteringWithoutAName_AuthController_ShouldSendNone")
    func registerWithoutName() async throws {
        let transport = Routes.transport(["POST /api/auth/register": Routes.json(Routes.session(email))])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        try await controller.register(email: email, password: "long enough pass", displayName: "   ")
        let body = try APIFixtures.object(transport.sent.last?.httpBody)
        #expect(body["displayName"] == nil)
    }

    @Test("whenTheNameBreaksTheRule_AuthController_ShouldRefuseBeforeSending")
    func registerRefusesBadName() async {
        let transport = Routes.transport([:])
        let controller = AuthFixtures.controller(transport: transport)
        await controller.restore()
        do {
            try await controller.register(
                email: email, password: "long enough pass", displayName: String(repeating: "a", count: 61))
            Issue.record("expected a failure")
        } catch {
            #expect(error.kind == .invalidInput)
        }
        #expect(transport.sent.isEmpty)
    }

    @Test(
        "whenValidatingAName_DisplayName_ShouldApplyTheServersRule",
        arguments: [
            ("Max", DisplayName.Verdict.valid("Max")),
            ("  Max Falicoff  ", .valid("Max Falicoff")),
            ("   ", .empty),
            (String(repeating: "a", count: 60), .valid(String(repeating: "a", count: 60))),
        ])
    func nameRule(text: String, verdict: DisplayName.Verdict) {
        #expect(DisplayName.validate(text) == verdict)
    }

    @Test("whenANameIsTooLongOrHasControlCharacters_DisplayName_ShouldRefuseIt")
    func nameRuleRefuses() {
        for text in [String(repeating: "a", count: 61), "Max\u{0007}", "Max\u{2028}Kim", "Max\nKim"] {
            guard case .invalid = DisplayName.validate(text) else {
                Issue.record("\(text.debugDescription) should be refused")
                continue
            }
        }
    }

    // MARK: Names and pictures

    @Test("whenAMemberHasANameAndPicture_HouseholdPeople_ShouldShowThemElseTheEmail")
    func namesAndFallbacks() {
        let people = HouseholdPeople(
            members: [
                WireHouseholdMember(userId: "u-me", email: email, joinedAt: 0),
                WireHouseholdMember(
                    userId: "u-bea", email: "bea.kim@example.test", joinedAt: 0, displayName: "Beatrice Kim",
                    avatarUrl: "/api/users/u-bea/avatar?v=2"),
                WireHouseholdMember(userId: "u-cam", email: "cam@example.test", joinedAt: 0, displayName: "  "),
            ], email: email)
        #expect(people.name("u-me") == "You")
        #expect(people.name("u-bea") == "Beatrice Kim")
        #expect(people.name("u-cam") == "cam@example.test")
        #expect(people.name("u-gone") == "Former member")
        #expect(people.face("u-bea") == PersonFace(initials: "BK", avatarUrl: "/api/users/u-bea/avatar?v=2"))
        #expect(people.face("u-cam") == PersonFace(initials: "CA"))
        #expect(people.initials("u-gone") == "?")
        #expect(HouseholdPeople.initials(name: "Max") == "MA")
        #expect(HouseholdPeople.initials(name: "Max Falicoff") == "MF")
        #expect(HouseholdPeople.initials(email: "bea.kim@example.test") == "BK")
    }

    @Test("whenLoadingAPicture_APIClient_ShouldSendTheSessionToTheSameServerPath")
    func avatarRequest() async throws {
        let transport = StubTransport { _ in HTTPResult(status: 200, body: Data([1, 2, 3])) }
        let client = try APIFixtures.client(transport: transport)
        let data = try await client.avatar("/api/users/u-bea/avatar?v=2")
        #expect(data == Data([1, 2, 3]))
        let request = try #require(transport.sent.first)
        #expect(request.url?.absoluteString == "https://penny.example.test/api/users/u-bea/avatar?v=2")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
    }

    @Test(
        "whenAPictureURLIsNotTheAvatarPath_APIClient_ShouldRefuseBeforeSending",
        arguments: [
            "https://other.example.test/api/users/u/avatar", "//other.example.test/api/users/u/avatar",
            "/api/users/../ledger/avatar", "/api/users/u/receipt", "/api/ledger", "/api/users/u/avatar#x",
        ])
    func avatarRefuses(path: String) async throws {
        let transport = StubTransport(json: "{}")
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: APIError.self) { _ = try await client.avatar(path) }
        #expect(transport.sent.isEmpty)
    }

    @Test("whenAPictureIsMissing_AvatarStore_ShouldRememberItAndRetryOtherFailures")
    func avatarStore() async {
        let calls = Mutex(0)
        let store = AvatarStore(fetch: { path in
            calls.withLock { $0 += 1 }
            if path.hasSuffix("gone") { throw APIError.notFound(message: nil) }
            if path.hasSuffix("offline") { throw APIError.offline }
            return Data([9])
        })
        await store.load("/a")
        await store.load("/a")
        #expect(store.data("/a") == Data([9]))
        await store.load("/gone")
        await store.load("/gone")
        #expect(store.entries["/gone"] == .missing)
        await store.load("/offline")
        #expect(store.entries["/offline"] == nil)
        #expect(calls.withLock { $0 } == 3)
    }

    // MARK: Profile model

    @Test("whenTheServerAsksForAName_ProfileModel_ShouldPromptOnceAndSaveOrSkip")
    func namePrompt() async throws {
        let service = FakeProfiles()
        service.me = WireMe(email: email, userId: "u-me", needsName: true)
        let model = ProfileModel(service: service)
        await model.refreshSummary()
        #expect(model.showsNamePrompt)
        await model.dismissNamePrompt()
        #expect(!model.showsNamePrompt)
        #expect(service.updates.last == WireProfileUpdate(namePromptDismissed: true))

        let saving = ProfileModel(service: service)
        await saving.refreshSummary()
        #expect(await saving.saveName("  Bea ") == nil)
        #expect(service.updates.last == WireProfileUpdate(displayName: "Bea"))
        #expect(saving.displayName == "Bea")
        #expect(!saving.showsNamePrompt)
    }

    @Test("whenAnOlderServerSendsNoNeedsName_ProfileModel_ShouldNotPrompt")
    func olderServer() async {
        let service = FakeProfiles()
        service.me = WireMe(email: email)
        let model = ProfileModel(service: service)
        await model.refreshSummary()
        #expect(!model.showsNamePrompt)
        #expect(model.displayName == nil)
    }

    @Test("whenTheNameIsBlankOrManaged_ProfileModel_ShouldClearItOrSayWhy")
    func saveNameCases() async {
        let service = FakeProfiles()
        let model = ProfileModel(service: service)
        #expect(await model.saveName("") == nil)
        #expect(service.updates.last == .clearingName())
        service.failure = APIError.forbidden(message: "Your sign-in provider manages your name.")
        #expect(await model.saveName("Max") == "Your sign-in provider manages your name.")
        #expect(await model.saveName(String(repeating: "x", count: 61)) != nil)
    }

    @Test("whenChangingThePassword_ProfileModel_ShouldSayWhatHappened")
    func changePassword() async {
        let service = FakeProfiles()
        let model = ProfileModel(service: service)
        #expect(
            await model.changePassword(current: "old password", new: "short")
                == .invalidNewPassword(
                    PasswordRules.lengthMessage))
        #expect(service.passwordChanges.isEmpty)
        #expect(await model.changePassword(current: "old password", new: "new password!") == .changed)
        #expect(
            service.passwordChanges == [
                WirePasswordChange(currentPassword: "old password", newPassword: "new password!")
            ])
        service.failure = APIError.badRequest(message: PasswordRules.wrongCurrent)
        #expect(
            await model.changePassword(current: "wrong", new: "new password!")
                == .wrongCurrentPassword(PasswordRules.wrongCurrent))
        service.failure = APIError.forbidden(message: nil)
        guard case .notAllowed = await model.changePassword(current: "x", new: "new password!") else {
            Issue.record("expected notAllowed")
            return
        }
        service.failure = APIError.rateLimited(retryAfter: 120)
        #expect(
            await model.changePassword(current: "x", new: "new password!")
                == .failed("Too many attempts. Please try again in 2 minutes."))
    }

    @Test("whenThePictureChanges_ProfileModel_ShouldShowTheNewOneOrTheFailure")
    func pictures() async {
        let service = FakeProfiles()
        let model = ProfileModel(service: service)
        #expect(await model.uploadPicture(Data([1])) == nil)
        #expect(model.avatarUrl == "/api/users/u-me/avatar?v=1")
        #expect(await model.removePicture() == nil)
        #expect(model.avatarUrl == nil)
        service.failure = APIError.payloadTooLarge(message: nil)
        #expect(await model.uploadPicture(Data([1])) == "This picture is too large. Choose one under 10 MB.")
    }
}

/// A profile server in memory.
final class FakeProfiles: ProfileService, @unchecked Sendable {
    var me = WireMe(email: "contract-user@example.test")
    var profile = WireProfile(userId: "u-me", email: "contract-user@example.test")
    var failure: (any Error)?
    var updates: [WireProfileUpdate] = []
    var passwordChanges: [WirePasswordChange] = []

    private func check() throws { if let failure { throw failure } }

    func me() async throws -> WireMe {
        try check()
        return me
    }
    func profile() async throws -> WireProfile {
        try check()
        return profile
    }
    func updateProfile(_ update: WireProfileUpdate) async throws -> WireProfile {
        try check()
        updates.append(update)
        if update.clearsName {
            profile.displayName = nil
        } else if let name = update.displayName {
            profile.displayName = name
        }
        profile.needsName = false
        return profile
    }
    func uploadAvatar(_ data: Data) async throws -> WireProfile {
        try check()
        profile.avatarUrl = "/api/users/u-me/avatar?v=1"
        return profile
    }
    func removeAvatar() async throws -> WireProfile {
        try check()
        profile.avatarUrl = nil
        return profile
    }
    func changePassword(_ change: WirePasswordChange) async throws {
        try check()
        passwordChanges.append(change)
    }
    func avatar(_ path: String) async throws -> Data {
        try check()
        return Data()
    }
}
