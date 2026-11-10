import Foundation
import PennyData
import PennyDomain
import Testing

@Suite("API client")
struct APIClientTests {
    private let ledgerJSON = """
        {"revision":3,"ledger":{"version":4,"currency":"CAD","categories":[],"accounts":[],"trips":[],
        "transactions":[],"recurring":[]}}
        """

    // MARK: Requests

    @Test("whenSignedIn_APIClient_ShouldSendBearerTokenToItsServerOnly")
    func sendsBearer() async throws {
        let transport = StubTransport(json: ledgerJSON)
        let snapshot = try await APIFixtures.client(transport: transport).ledger()
        #expect(snapshot.revision == 3)
        let request = try #require(transport.sent.first)
        #expect(request.url?.absoluteString == "https://penny.example.test/api/ledger")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
        #expect(request.httpShouldHandleCookies == false)
        #expect(request.timeoutInterval == 30)
    }

    @Test("whenSessionBelongsToAnotherServer_APIClient_ShouldRefuseToBeCreated")
    func refusesForeignSession() {
        let foreign = APIFixtures.session(server: APIFixtures.otherServer)
        #expect(throws: APIError.invalidRequest(.wrongServer)) {
            try APIFixtures.client(session: foreign, transport: StubTransport(json: "{}"))
        }
    }

    @Test("whenSessionSwitchedToAnotherServer_APIClient_ShouldRefuseAndSendNothing")
    func signedInRefusesForeignSession() throws {
        let client = try APIFixtures.client(session: nil, transport: StubTransport(json: "{}"))
        #expect(throws: APIError.invalidRequest(.wrongServer)) {
            try client.signedIn(as: APIFixtures.session(server: APIFixtures.otherServer))
        }
    }

    @Test("whenUnauthenticatedCall_APIClient_ShouldNeverSendAToken")
    func infoSendsNoToken() async throws {
        let transport = StubTransport(json: #"{"name":"penny","version":"1.0.0"}"#)
        let info = try await APIFixtures.client(transport: transport).info()
        #expect(info.version == "1.0.0")
        #expect(transport.sent.first?.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test("whenNotSignedIn_APIClient_ShouldFailLocallyWithUnauthorized")
    func notSignedIn() async throws {
        let transport = StubTransport(json: ledgerJSON)
        let client = try APIFixtures.client(session: nil, transport: transport)
        await #expect(throws: APIError.unauthorized(message: nil)) { try await client.ledger() }
        #expect(transport.sent.isEmpty)
    }

    @Test("whenServerHasPathPrefix_APIClient_ShouldKeepItInTheURL")
    func keepsPathPrefix() async throws {
        let server = try ServerURL("https://example.test/penny")
        let transport = StubTransport(json: ledgerJSON)
        let client = try APIFixtures.client(
            session: APIFixtures.session(server: server), server: server, transport: transport)
        _ = try await client.ledger()
        #expect(transport.sent.first?.url?.absoluteString == "https://example.test/penny/api/ledger")
    }

    @Test("whenTokenIsNotSixtyFourLowercaseHex_ServerSession_ShouldFailAndNeverPrintTheToken")
    func rejectsBadToken() {
        for token in ["", "AB" + String(repeating: "a", count: 62), String(repeating: "g", count: 64)] {
            #expect(throws: APIError.invalidRequest(.invalidToken)) {
                try ServerSession(server: APIFixtures.server, email: "a@b.test", token: token)
            }
        }
        let description = "\(APIFixtures.session())"
        #expect(!description.contains(APIFixtures.token))
        #expect(description.contains("<redacted>"))
    }

    // MARK: Auth

    @Test("whenLoginSucceeds_APIClient_ShouldReturnSessionBoundToItsServer")
    func login() async throws {
        let json = #"{"token":"\#(APIFixtures.token)","email":"contract-user@example.test"}"#
        let transport = StubTransport(json: json)
        let client = try APIFixtures.client(session: nil, transport: transport)
        let credentials = WireCredentials(email: "contract-user@example.test", password: "synthetic")
        let session = try await client.login(credentials)
        #expect(session.server == APIFixtures.server)
        #expect(session.tokenForStorage == APIFixtures.token)
        let request = try #require(transport.sent.first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test("whenLoginReturnsABadToken_APIClient_ShouldThrowMalformedResponse")
    func loginBadToken() async throws {
        let transport = StubTransport(json: #"{"token":"short","email":"a@b.test"}"#)
        let client = try APIFixtures.client(session: nil, transport: transport)
        await #expect(throws: APIError.malformedResponse) {
            try await client.login(WireCredentials(email: "a@b.test", password: "synthetic"))
        }
    }

    // MARK: Errors

    @Test(
        "whenErrorStatus_APIClient_ShouldThrowTheMatchingStructuredError",
        arguments: [
            (400, APIError.badRequest(message: "bad")),
            (401, APIError.unauthorized(message: "bad")),
            (403, APIError.forbidden(message: "bad")),
            (404, APIError.notFound(message: "bad")),
            (409, APIError.conflict(message: "bad")),
            (413, APIError.payloadTooLarge(message: "bad")),
            (500, APIError.server(status: 500, message: "bad")),
            (502, APIError.server(status: 502, message: "bad")),
            (302, APIError.unexpectedStatus(302)),
        ])
    func statusMapping(status: Int, expected: APIError) async throws {
        let transport = StubTransport(status: status, json: #"{"error":"bad"}"#)
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: expected) { try await client.ledger() }
    }

    @Test("whenRateLimitedOrUnavailable_APIClient_ShouldExposeRetryAfter")
    func retryAfter() async throws {
        let limited = try APIFixtures.client(
            transport: StubTransport(status: 429, headers: ["retry-after": "7"], json: #"{"error":"slow"}"#))
        await #expect(throws: APIError.rateLimited(retryAfter: 7)) { try await limited.ledger() }

        let unavailable = try APIFixtures.client(
            transport: StubTransport(status: 503, headers: ["retry-after": "1"], json: #"{"error":"busy"}"#))
        await #expect(throws: APIError.unavailable(retryAfter: 1, message: "busy")) { try await unavailable.ledger() }
        #expect(APIError.unavailable(retryAfter: 1, message: nil).isRetryable)
        #expect(APIError.rateLimited(retryAfter: 7).retryAfter == 7)
    }

    @Test("whenErrorBodyIsNotJSON_APIClient_ShouldStillThrowTheStatusError")
    func nonJSONErrorBody() async throws {
        let client = try APIFixtures.client(transport: StubTransport(status: 500, json: "<html>oops</html>"))
        await #expect(throws: APIError.server(status: 500, message: nil)) { try await client.ledger() }
    }

    @Test("whenUnauthorized_APIError_ShouldRequireSignInAndNotBeRetryable")
    func unauthorizedFlags() {
        let error = APIError.unauthorized(message: nil)
        #expect(error.requiresSignIn)
        #expect(!error.isRetryable)
        #expect(!APIError.conflict(message: nil).isRetryable)
        #expect(!APIError.badRequest(message: nil).isRetryable)
    }

    @Test(
        "whenNetworkFails_APIClient_ShouldMapTransportErrors",
        arguments: [
            (URLError.Code.notConnectedToInternet, APIError.offline),
            (.networkConnectionLost, .offline),
            (.timedOut, .timeout),
            (.cannotFindHost, .unreachable),
            (.secureConnectionFailed, .unreachable),
        ])
    func transportErrors(code: URLError.Code, expected: APIError) async throws {
        let client = try APIFixtures.client(transport: StubTransport { _ in throw URLError(code) })
        await #expect(throws: expected) { try await client.ledger() }
    }

    @Test(
        "whenResponseBodyIsMalformed_APIClient_ShouldThrowMalformedResponse",
        arguments: ["", "not json", #"{"revision":"3"}"#, #"{"revision":1,"ledger":{"version":4}}"#])
    func malformed(body: String) async throws {
        let client = try APIFixtures.client(transport: StubTransport(json: body))
        await #expect(throws: APIError.malformedResponse) { try await client.ledger() }
    }

    @Test("whenServerIsNotPenny_APIClient_ShouldRejectInfo")
    func notPenny() async throws {
        let client = try APIFixtures.client(transport: StubTransport(json: #"{"name":"other","version":"1"}"#))
        await #expect(throws: APIError.malformedResponse) { try await client.info() }
    }

    // MARK: Cancellation

    @Test("whenTaskIsCancelled_APIClient_ShouldThrowCancellationNotAnAPIError")
    func cancellation() async throws {
        let transport = StubTransport { _ in
            try await Task.sleep(for: .seconds(60))
            return HTTPResult(status: 200)
        }
        let client = try APIFixtures.client(transport: transport)
        let task = Task { try await client.ledger() }
        while transport.sent.isEmpty { await Task.yield() }
        task.cancel()
        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test("whenURLSessionReportsCancelled_APIClient_ShouldThrowCancellationError")
    func urlErrorCancelled() async throws {
        let client = try APIFixtures.client(transport: StubTransport { _ in throw URLError(.cancelled) })
        await #expect(throws: CancellationError.self) { try await client.ledger() }
    }

    // MARK: Ledger

    @Test("whenStaleRevision_APIClient_ShouldThrowConflictAndLeaveTheRequestUnchanged")
    func staleRevision() async throws {
        let message = "Your data changed on another device. Please refresh and try again."
        let transport = StubTransport(status: 409, json: #"{"error":"\#(message)"}"#)
        let client = try APIFixtures.client(transport: transport)
        let ledger = WireLedger(
            version: 4, currency: "CAD", categories: [], accounts: [], trips: [], transactions: [], recurring: [])
        await #expect(throws: APIError.conflict(message: message)) {
            try await client.putLedger(LedgerSnapshot(revision: 0, ledger: ledger))
        }
        let request = try #require(transport.sent.first)
        #expect(request.httpMethod == "PUT")
        let body = try APIFixtures.object(request.httpBody)
        #expect(body["revision"] as? Int == 0)
    }

    // MARK: Receipts

    @Test("whenUploadingReceipt_APIClient_ShouldSendBase64JSONAndReturnReceipt")
    func uploadReceipt() async throws {
        let transport = StubTransport(
            status: 201, json: #"{"id":"r1","name":"a.png","mime":"image/png","uri":"/api/receipts/r1"}"#)
        let receipt = try await APIFixtures.client(transport: transport)
            .uploadReceipt(name: "a.png", mime: "image/png", data: Data([1, 2, 3]))
        #expect(receipt.id == "r1")
        let request = try #require(transport.sent.first)
        #expect(request.timeoutInterval == 120)
        let body = try APIFixtures.object(request.httpBody)
        #expect(body["base64"] as? String == "AQID")
        #expect(body["mime"] as? String == "image/png")
    }

    @Test(
        "whenReceiptBreaksContractLimits_APIClient_ShouldFailBeforeSending",
        arguments: [("", "image/png"), ("a.exe", "application/x-msdownload")])
    func invalidUpload(name: String, mime: String) async throws {
        let transport = StubTransport(json: "{}")
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: APIError.self) { try await client.uploadReceipt(name: name, mime: mime, data: Data()) }
        #expect(transport.sent.isEmpty)
    }

    @Test("whenReceiptIdHasPathCharacters_APIClient_ShouldEncodeItInOneSegment")
    func receiptIdIsEncoded() async throws {
        let headers = ["content-type": "image/png", "content-disposition": "inline; filename*=UTF-8''caf%C3%A9.png"]
        let transport = StubTransport { _ in HTTPResult(status: 200, headers: headers, body: Data([9])) }
        let file = try await APIFixtures.client(transport: transport).receipt(id: "../ledger?x=1#f")
        #expect(file.mime == "image/png")
        #expect(file.filename == "café.png")
        #expect(file.data == Data([9]))
        let url = try #require(transport.sent.first?.url?.absoluteString)
        #expect(url == "https://penny.example.test/api/receipts/..%2Fledger%3Fx%3D1%23f")
        #expect(transport.sent.first?.timeoutInterval == 120)
    }

    @Test("whenReceiptReplyIsJSON_APIClient_ShouldThrowMalformedResponse")
    func receiptNotBytes() async throws {
        let transport = StubTransport { _ in
            HTTPResult(status: 200, headers: ["content-type": "application/json"], body: Data("{}".utf8))
        }
        let client = try APIFixtures.client(transport: transport)
        await #expect(throws: APIError.malformedResponse) { try await client.receipt(id: "r1") }
    }

    @Test("whenReceiptIsMissing_APIClient_ShouldThrowNotFound")
    func receiptMissing() async throws {
        let client = try APIFixtures.client(transport: StubTransport(status: 404, json: #"{"error":"Not found."}"#))
        await #expect(throws: APIError.notFound(message: "Not found.")) { try await client.receipt(id: "nope") }
    }

    // MARK: Configuration

    @Test("whenTimeoutsAreOutOfRange_APIConfiguration_ShouldClampThem")
    func clampsTimeouts() {
        let configuration = APIConfiguration(server: APIFixtures.server, requestTimeout: 0, transferTimeout: 9999)
        #expect(configuration.requestTimeout == 1)
        #expect(configuration.transferTimeout == 120)
    }
}
