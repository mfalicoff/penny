/// A page of results tagged with what it answers, so a caller can also check it itself.
public struct SearchPage: Equatable, Sendable {
    public let scope: AccountScope
    public let request: SearchRequest
    public let response: SearchResponse
}

/// Runs searches for one account and keeps stale answers out of the UI.
///
/// Every `start` cancels the search in flight and begins a new generation; every answer is
/// checked against its generation and account scope before it is returned. A slow response
/// to an old query, or to a previous account or server, throws `CancellationError` instead
/// of being shown. Paging continues the latest query only, with the cursor the server gave
/// for it. `reset(client:)` (sign-out, account or server change) drops the query, the
/// cursor and anything in flight.
///
/// Wire results stay here as `SearchPage`; view state is built from them elsewhere.
public actor SearchCoordinator {
    private var client: APIClient
    private var generation = 0
    private var current: SearchRequest?
    private var cursor: String?
    private var inFlight: Task<SearchResponse, any Error>?

    public init(client: APIClient) {
        self.client = client
    }

    public var scope: AccountScope? { client.scope }

    /// Starts a new query from its first page. Any cursor in `request` is ignored.
    public func start(_ request: SearchRequest) async throws -> SearchPage {
        var first = request
        first.cursor = nil
        generation += 1
        current = first
        cursor = nil
        return try await run(first, generation: generation)
    }

    /// The next page of the latest query, or nil when it has no more (or none started).
    public func nextPage() async throws -> SearchPage? {
        guard let current, let cursor else { return nil }
        var request = current
        request.cursor = cursor
        generation += 1
        return try await run(request, generation: generation)
    }

    /// Cancels in-flight work and forgets the query, for example when the field is cleared.
    public func cancel() {
        generation += 1
        inFlight?.cancel()
        inFlight = nil
        current = nil
        cursor = nil
    }

    /// Switches to another client, account or server and drops all search state.
    public func reset(client: APIClient) {
        cancel()
        self.client = client
    }

    private func run(_ request: SearchRequest, generation expected: Int) async throws -> SearchPage {
        inFlight?.cancel()
        let client = self.client
        let scope = client.scope
        let task = Task { try await client.search(request) }
        inFlight = task
        // Cancelling the caller cancels the request.
        let response = try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
        guard expected == generation, scope == self.client.scope, let scope else { throw CancellationError() }
        cursor = response.nextCursor
        return SearchPage(scope: scope, request: request.withoutCursor, response: response)
    }
}
