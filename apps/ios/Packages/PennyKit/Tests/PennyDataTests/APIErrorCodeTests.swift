import Foundation
import Testing

@testable import PennyData

/// MAZ-187: the stable `code` next to every API error (contract 2.1.0). The app branches on it
/// first and keeps its status-and-message handling for servers from before 2.1.0, which send none.
@Suite("API error codes")
struct APIErrorCodeTests {
    // MARK: Contract

    @Test("whenComparedWithTheContract_APIErrorCode_ShouldListExactlyItsCodes")
    func matchesContract() throws {
        let root = try JSONSerialization.jsonObject(with: Data(contentsOf: Self.openAPI)) as? [String: Any]
        let schemas = (root?["components"] as? [String: Any])?["schemas"] as? [String: Any]
        let error = try #require(schemas?["Error"] as? [String: Any])
        let code = try #require((error["properties"] as? [String: Any])?["code"] as? [String: Any])
        let contract = try #require(code["enum"] as? [String])
        #expect(APIErrorCode.all.map(\.rawValue).sorted() == contract.sorted())
        #expect(Set(APIErrorCode.all).count == APIErrorCode.all.count)
        #expect(Set(error["required"] as? [String] ?? []) == ["error", "code"])
    }

    nonisolated private static var openAPI: URL {
        var url = URL(filePath: #filePath)
        while url.path() != "/", !FileManager.default.fileExists(atPath: url.appending(path: "contracts").path()) {
            url.deleteLastPathComponent()
        }
        return url.appending(path: "contracts/openapi.json")
    }

    // MARK: Decoding

    @Test(
        "whenTheServerAnswersAnError_APIClient_ShouldKeepItsCodeOrNoneFromAnOlderServer",
        arguments: [
            (#"{"error":"Expense changed. Refresh and try again.","code":"expense.changed"}"#, "expense.changed"),
            (#"{"error":"Expense changed. Refresh and try again."}"#, nil),
            (#"{"error":"Something new.","code":"future.unknown_code"}"#, "future.unknown_code"),
            ("<html>oops</html>", nil),
        ] as [(String, String?)])
    func decodesCode(body: String, code: String?) async throws {
        let client = try APIFixtures.client(transport: StubTransport(status: 409, json: body))
        do {
            _ = try await client.ledger()
            Issue.record("a 409 succeeded")
        } catch let error as APIError {
            guard case .conflict = error else {
                Issue.record("expected a conflict, got \(error)")
                return
            }
            #expect(error.code?.rawValue == code)
            #expect(error.status == 409)
            #expect(!error.isRetryable, "an unknown code still means what its status means")
        }
    }

    @Test("whenEveryStatusCarriesACode_APIError_ShouldExposeItAndItsMessage")
    func exposesCode() {
        let errors: [APIError] = [
            .badRequest(message: "m", code: .requestInvalid), .unauthorized(message: "m", code: .requestInvalid),
            .forbidden(message: "m", code: .requestInvalid), .notFound(message: "m", code: .requestInvalid),
            .conflict(message: "m", code: .requestInvalid), .payloadTooLarge(message: "m", code: .requestInvalid),
            .unavailable(retryAfter: nil, message: "m", code: .requestInvalid),
            .server(status: 500, message: "m", code: .requestInvalid),
        ]
        for error in errors {
            #expect(error.code == .requestInvalid)
            #expect(error.message == "m")
        }
        #expect(APIError.rateLimited(retryAfter: 3, code: .inviteTooMany).code == .inviteTooMany)
        #expect(APIError.offline.code == nil)
        #expect(APIError.offline.status == nil)
    }

    @Test("whenMatchingACode_APIError_ShouldUseTheLegacyRuleOnlyWithoutACode")
    func matching() {
        let coded = APIError.badRequest(message: "Receipt does not belong to this account.", code: .requestInvalid)
        #expect(!coded.matches(.ledgerForeignReceipt, legacyText: "does not belong"), "another code is never it")
        #expect(
            APIError.badRequest(message: "Reworded.", code: .ledgerForeignReceipt).matches(
                .ledgerForeignReceipt, legacyText: "does not belong"))
        #expect(
            APIError.badRequest(message: "Receipt does not belong to this account.").matches(
                .ledgerForeignReceipt, legacyText: "does not belong"))
        #expect(!APIError.badRequest(message: "Other.").matches(.ledgerForeignReceipt, legacyText: "does not belong"))
    }

    // MARK: Households

    @Test(
        "whenTheServerSendsACode_HouseholdFailure_ShouldGoByTheCodeNotTheMessage",
        arguments: [
            (APIError.notFound(message: "Gone.", code: .householdNotFound), HouseholdFailure.Kind.membership),
            (.notFound(message: "Gone.", code: .settlementMonthNotFound), .membership),
            (.notFound(message: "Household not found.", code: .expenseNotFound), .gone),
            (.notFound(message: nil, code: .recurringRuleNotFound), .gone),
            (.conflict(message: "Reworded.", code: .expenseChanged), .stale),
            (.conflict(message: "Reworded.", code: .recurringRuleChanged), .stale),
            (.conflict(message: "Reworded.", code: .settlementNotSuggested), .stale),
            (.conflict(message: "Expense changed. Refresh and try again.", code: .expenseAlreadyPaid), .restricted),
            (.badRequest(message: "Reworded.", code: .householdInvalidInvite), .invalidInvite),
            (.badRequest(message: "Invite code is invalid or expired.", code: .requestInvalid), .invalid),
        ] as [(APIError, HouseholdFailure.Kind)])
    func householdCodes(error: APIError, kind: HouseholdFailure.Kind) {
        #expect(HouseholdFailure(error).kind == kind)
    }

    @Test(
        "whenTheServerSendsNoCode_HouseholdFailure_ShouldStillMatchTheMessagesOfOlderServers",
        arguments: [
            (APIError.notFound(message: "Household not found."), HouseholdFailure.Kind.membership),
            (.notFound(message: nil), .membership),
            (.notFound(message: "Month not found."), .membership),
            (.notFound(message: "Expense not found."), .gone),
            (.conflict(message: "Expense changed. Refresh and try again."), .stale),
            (.conflict(message: "That is no longer the full suggested amount."), .stale),
            (.conflict(message: "This expense is already paid."), .restricted),
            (.badRequest(message: "Invite code is invalid or expired."), .invalidInvite),
        ] as [(APIError, HouseholdFailure.Kind)])
    func householdLegacy(error: APIError, kind: HouseholdFailure.Kind) {
        #expect(HouseholdFailure(error).kind == kind)
    }

    @Test(
        "whenAnEmailInviteFails_HouseholdFailure_ShouldGoByTheCodeAndFallBackToTheMessage",
        arguments: [
            (APIError.notFound(message: "Email is off.", code: .mailDisabled), HouseholdFailure.Kind.emailOff),
            (.notFound(message: "Revoked.", code: .inviteNotFound), .gone),
            (.notFound(message: "This server doesn't send email."), .emailOff),
            (.notFound(message: "Invitation not found."), .gone),
            // Another 404 is about the household, as for any household call.
            (.notFound(message: "This server doesn't send email.", code: .householdNotFound), .membership),
            (.conflict(message: "Joined.", code: .inviteJoined), .restricted),
            (.rateLimited(retryAfter: nil, code: .inviteTooMany), .rateLimited),
        ] as [(APIError, HouseholdFailure.Kind)])
    func emailInvite(error: APIError, kind: HouseholdFailure.Kind) {
        #expect(HouseholdFailure.emailInvite(error).kind == kind)
    }

    // MARK: Sign-in

    @Test(
        "whenRegistrationIsClosed_AuthController_ShouldSaySoForPasswordsAndSingleSignOn",
        arguments: [
            (
                APIError.forbidden(message: "Closed.", code: .authOidcRegistrationDisabled), SignInMethod.singleSignOn,
                AuthFailure.Kind.registrationDisabled
            ),
            (.forbidden(message: "Closed.", code: .authRegistrationDisabled), .password, .registrationDisabled),
            (.forbidden(message: "Refused.", code: .originForbidden), .singleSignOn, .singleSignOnRejected),
            (.forbidden(message: "Refused."), .singleSignOn, .singleSignOnRejected),
            (.forbidden(message: "Closed."), .password, .registrationDisabled),
        ] as [(APIError, SignInMethod, AuthFailure.Kind)])
    @MainActor
    func registrationClosed(error: APIError, method: SignInMethod, kind: AuthFailure.Kind) {
        #expect(AuthController.failure(error, during: method, server: AuthFixtures.server).kind == kind)
    }
}
