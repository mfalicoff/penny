import Foundation
import PennyData
import Testing

@Suite("Search client")
struct SearchClientTests {
    private let emptyPage = #"{"version":1,"items":[],"totalCount":0,"nextCursor":null}"#

    @Test("whenQueryHasSpaces_Search_ShouldSendItTrimmedToTheSearchEndpointAsPOST")
    func sendsTrimmedQuery() async throws {
        let transport = StubTransport(json: emptyPage)
        _ = try await APIFixtures.client(transport: transport).search(SearchRequest(query: "  coffee  "))
        let request = try #require(transport.sent.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/v1/search/transactions")
        let body = try APIFixtures.object(request.httpBody)
        #expect(body["query"] as? String == "coffee")
    }

    @Test("whenSharedInvalidRequestFixtures_Search_ShouldNeverReachTheTransportWhenClientCanTellLocally")
    func invalidFixtures() async throws {
        let transport = StubTransport(json: emptyPage)
        let client = try APIFixtures.client(transport: transport)
        var refused = 0
        var accepted: [String] = []
        for data in try APIFixtures.elements("search-cases.json", "invalidRequests") {
            // Values the Swift type cannot express (wrong enums, 1.5 page size) fail to decode.
            guard let request = try? JSONDecoder().decode(SearchRequest.self, from: data) else {
                refused += 1
                continue
            }
            do {
                _ = try await client.search(request)
                accepted.append(String(decoding: data, as: UTF8.self))
            } catch is APIError {
                refused += 1
            }
        }
        // Only `userId` (not a member of the Swift type, so it can never be sent) and an explicit
        // null query (the same as omitting it) remain; the server rejects both from other clients.
        #expect(refused == 12)
        #expect(accepted.count == 2)
        #expect(accepted.allSatisfy { $0.contains("userId") || $0.contains("null") })
        let sent = transport.sent.map { String(decoding: $0.httpBody ?? Data(), as: UTF8.self) }
        #expect(sent.allSatisfy { !$0.contains("userId") })
    }

    @Test(
        "whenRequestBreaksLimits_Search_ShouldFailWithTheFieldName",
        arguments: [
            (SearchRequest(from: "2026-11-30", to: "2026-11-01"), "from"),
            (SearchRequest(from: "1999-12-31"), "from"),
            (SearchRequest(to: "2101-01-01"), "to"),
            (SearchRequest(to: "2026-02-30"), "to"),
            (SearchRequest(from: "2026-1-1"), "from"),
            (SearchRequest(pageSize: 0), "pageSize"),
            (SearchRequest(pageSize: 101), "pageSize"),
            (SearchRequest(query: String(repeating: "x", count: 201)), "query"),
            (SearchRequest(cursor: ""), "cursor"),
            (SearchRequest(cursor: String(repeating: "c", count: 2049)), "cursor"),
        ])
    func limits(request: SearchRequest, field: String) async throws {
        let client = try APIFixtures.client(transport: StubTransport(json: emptyPage))
        await #expect(throws: APIError.invalidRequest(.invalidField(field))) { try await client.search(request) }
    }

    @Test("whenLeapDayAndBoundaries_Search_ShouldAcceptRealDates")
    func acceptsRealDates() async throws {
        let client = try APIFixtures.client(transport: StubTransport(json: emptyPage))
        _ = try await client.search(SearchRequest(from: "2000-01-01", to: "2100-12-31"))
        _ = try await client.search(SearchRequest(from: "2028-02-29", to: "2028-02-29"))
    }

    @Test("whenServerCannotSearch_Search_ShouldThrowNotFoundSoCallersFallBackToLocal")
    func notFoundMeansLocalFallback() async throws {
        let client = try APIFixtures.client(transport: StubTransport(status: 404, json: #"{"error":"Not found."}"#))
        await #expect(throws: APIError.notFound(message: "Not found.")) { try await client.search(SearchRequest()) }
    }

    @Test("whenSessionExpired_Search_ShouldThrowUnauthorized")
    func unauthorized() async throws {
        let client = try APIFixtures.client(transport: StubTransport(status: 401, json: #"{"error":"Sign in."}"#))
        await #expect(throws: APIError.unauthorized(message: "Sign in.")) { try await client.search(SearchRequest()) }
    }

    @Test("whenCursorFromAnotherQuery_Search_ShouldSurfaceTheServersBadRequest")
    func foreignCursor() async throws {
        let client = try APIFixtures.client(
            transport: StubTransport(status: 400, json: #"{"error":"Invalid search cursor."}"#))
        await #expect(throws: APIError.badRequest(message: "Invalid search cursor.")) {
            try await client.search(SearchRequest(query: "x", cursor: "eyJ2IjoxfQ"))
        }
    }

    @Test(
        "whenResponseBreaksContract_Search_ShouldThrowMalformedResponse",
        arguments: [
            #"{"version":2,"items":[],"totalCount":0,"nextCursor":null}"#,
            #"{"version":1,"items":[],"totalCount":-1,"nextCursor":null}"#,
            #"{"version":1,"items":[]}"#,
            #"{"version":1,"items":[{"key":"x","source":"personal"}],"totalCount":1,"nextCursor":null}"#,
        ])
    func malformedResponse(json: String) async throws {
        let client = try APIFixtures.client(transport: StubTransport(json: json))
        await #expect(throws: APIError.malformedResponse) { try await client.search(SearchRequest()) }
    }
}

@Suite("Search coordinator")
struct SearchCoordinatorTests {
    private func page(cursor: String?, key: String) -> String {
        let next = cursor.map { "\"\($0)\"" } ?? "null"
        return """
            {"version":1,"items":[{"key":"personal:\(key)","source":"personal","match":null,
            "entry":{"id":"\(key)","title":"T","kind":"expense","total":1,"share":0,"categoryId":"c",
            "date":"2026-01-01","note":""}}],"totalCount":2,"nextCursor":\(next)}
            """
    }

    @Test("whenPaging_SearchCoordinator_ShouldReuseQueryWithTheServersCursor")
    func paging() async throws {
        let transport = StubTransport { request in
            let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
            let json =
                body.contains("\"cursor\":\"c1\"")
                ? #"{"version":1,"items":[],"totalCount":2,"nextCursor":null}"#
                : #"{"version":1,"items":[],"totalCount":2,"nextCursor":"c1"}"#
            return HTTPResult(status: 200, body: Data(json.utf8))
        }
        let coordinator = SearchCoordinator(client: try APIFixtures.client(transport: transport))
        let first = try await coordinator.start(SearchRequest(query: "coffee", cursor: "ignored"))
        #expect(first.response.nextCursor == "c1")
        #expect(first.request.cursor == nil)
        let second = try await coordinator.nextPage()
        #expect(second?.response.nextCursor == nil)
        #expect(second?.scope == APIFixtures.session().scope)
        #expect(try await coordinator.nextPage() == nil)
        let bodies = transport.sent.map { String(decoding: $0.httpBody ?? Data(), as: UTF8.self) }
        #expect(!bodies[0].contains("ignored"))
        #expect(bodies[1].contains("\"query\":\"coffee\""))
    }

    @Test("whenQueryChangesWhileInFlight_SearchCoordinator_ShouldDropTheStaleAnswer")
    func staleQuery() async throws {
        let gate = AsyncGate()
        let transport = StubTransport { [self] request in
            let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
            if body.contains("old") {
                await gate.wait()
                return HTTPResult(status: 200, body: Data(page(cursor: nil, key: "old").utf8))
            }
            return HTTPResult(status: 200, body: Data(page(cursor: nil, key: "new").utf8))
        }
        let coordinator = SearchCoordinator(client: try APIFixtures.client(transport: transport))
        let stale = Task { try await coordinator.start(SearchRequest(query: "old")) }
        while transport.sent.isEmpty { await Task.yield() }
        let fresh = try await coordinator.start(SearchRequest(query: "new"))
        #expect(fresh.response.items.first?.key == "personal:new")
        await gate.open()
        await #expect(throws: CancellationError.self) { try await stale.value }
    }

    @Test("whenAccountChangesWhileInFlight_SearchCoordinator_ShouldNeverReturnTheOldAccountsResults")
    func staleAccount() async throws {
        let gate = AsyncGate()
        let transport = StubTransport { [self] _ in
            await gate.wait()
            return HTTPResult(status: 200, body: Data(page(cursor: "c9", key: "a").utf8))
        }
        let coordinator = SearchCoordinator(client: try APIFixtures.client(transport: transport))
        let stale = Task { try await coordinator.start(SearchRequest(query: "x")) }
        while transport.sent.isEmpty { await Task.yield() }
        let other = try APIFixtures.client(
            session: APIFixtures.session(email: "contract-peer@example.test"), transport: StubTransport(json: "{}"))
        await coordinator.reset(client: other)
        await gate.open()
        await #expect(throws: CancellationError.self) { try await stale.value }
        #expect(try await coordinator.nextPage() == nil)
        #expect(await coordinator.scope == APIFixtures.session(email: "contract-peer@example.test").scope)
    }

    @Test("whenCancelled_SearchCoordinator_ShouldForgetTheCursor")
    func cancelForgetsCursor() async throws {
        let transport = StubTransport { [self] _ in
            HTTPResult(status: 200, body: Data(page(cursor: "c1", key: "a").utf8))
        }
        let coordinator = SearchCoordinator(client: try APIFixtures.client(transport: transport))
        _ = try await coordinator.start(SearchRequest(query: "x"))
        await coordinator.cancel()
        #expect(try await coordinator.nextPage() == nil)
    }

    @Test("whenSearchFails_SearchCoordinator_ShouldPropagateStructuredErrorAndNotPage")
    func failureKeepsNoCursor() async throws {
        let transport = StubTransport(status: 503, headers: ["retry-after": "1"], json: #"{"error":"busy"}"#)
        let coordinator = SearchCoordinator(client: try APIFixtures.client(transport: transport))
        await #expect(throws: APIError.unavailable(retryAfter: 1, message: "busy")) {
            try await coordinator.start(SearchRequest(query: "x"))
        }
        #expect(try await coordinator.nextPage() == nil)
    }
}

/// Suspends callers until opened; lets a test hold a response in flight.
actor AsyncGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        for waiter in waiters { waiter.resume() }
        waiters.removeAll()
    }
}
