import Foundation
import PennyData
import PennyDomain
import Testing

/// A scripted server search: answers in order, optionally held until released.
@MainActor
final class FakeEntrySearch: EntrySearchService {
    var searchEpoch = 0
    var reason: DeviceSearchReason?
    var reconciliations: [SearchReconciliation] = []
    var answers: [Result<SearchPage, any Error>] = []
    var nextPages: [SearchPage?] = []
    private(set) var requests: [SearchRequest] = []
    private(set) var cancels = 0
    var holdNext = false
    private var held: [CheckedContinuation<Void, Never>] = []

    func deviceReason(serverHasSearch: Bool) -> DeviceSearchReason? {
        serverHasSearch ? reason : .serverWithoutSearch
    }

    func reconcile(_ page: SearchPage, startedAt epoch: Int) -> SearchReconciliation {
        if !reconciliations.isEmpty { return reconciliations.removeFirst() }
        return epoch == searchEpoch ? .show(page) : .searchAgain
    }

    func search(_ request: SearchRequest) async throws -> SearchPage {
        requests.append(request)
        let answer = answers.isEmpty ? .failure(APIError.malformedResponse) : answers.removeFirst()
        if holdNext {
            holdNext = false
            await withCheckedContinuation { held.append($0) }
        }
        return try answer.get()
    }

    func nextPage() async throws -> SearchPage? {
        nextPages.isEmpty ? nil : nextPages.removeFirst()
    }

    func cancel() async { cancels += 1 }

    func release() {
        for continuation in held { continuation.resume() }
        held = []
    }
}

@Suite("Activity search (MAZ-73)")
@MainActor
struct ActivitySearchModelTests {
    static let november = MonthKey(year: 2026, month: 11) ?? MonthKey(.day("2026-11-01"))
    let service = FakeEntrySearch()
    let model: ActivitySearchModel

    init() {
        model = ActivitySearchModel(service: service, debounce: .zero)
    }

    static func filters(_ query: String, kind: EntryKind? = nil) -> ActivityFilters {
        ActivityFilters(period: .month(november), kind: kind, query: query)
    }

    static func page(_ keys: [String], cursor: String? = nil) throws -> SearchPage {
        try LedgerSyncModelTests.page(scope: Offline.scope(), keys: keys, cursor: cursor)
    }

    @Test("whenTheDemoSearches_ActivitySearch_ShouldStayOnThisDevice")
    func demo() {
        let demo = ActivitySearchModel(service: nil, debounce: .zero)
        demo.update(Self.filters("coffee"))
        #expect(demo.source == .device(.demo))
        #expect(demo.status == .idle)
    }

    @Test("whenThereIsNoQuery_ActivitySearch_ShouldListThisDeviceWithoutAskingTheServer")
    func browsing() {
        model.update(Self.filters("   "))
        #expect(model.source == .device(nil))
        #expect(service.requests.isEmpty)
    }

    @Test("whenTheServerAnswers_ActivitySearch_ShouldShowItsPageAskedInDateOrder")
    func serverResults() async throws {
        service.answers = [.success(try Self.page(["personal:lunch", "shared:dinner"]))]
        model.update(Self.filters("  lunch ", kind: .expense))
        await eventually("results") { model.status == .results }
        let request = try #require(service.requests.first)
        #expect(request.query == "lunch")
        #expect(request.from == "2026-11-01" && request.to == "2026-11-30")
        #expect(request.kind == .expense && request.source == .all)
        #expect(request.sort == .dateDescending, "Activity stays chronological")
        #expect(request.pageSize == 50)
        #expect(model.source == .server && model.totalCount == 2)
        #expect(model.answered == Self.filters("  lunch ", kind: .expense))

        model.update(Self.filters("  lunch ", kind: .expense))
        #expect(service.requests.count == 1, "the same filters and ledger search once")
    }

    @Test("whenAnOlderAnswerArrivesLate_ActivitySearch_ShouldKeepTheNewerResults")
    func staleAnswer() async throws {
        service.answers = [.success(try Self.page(["personal:old"])), .success(try Self.page(["personal:new"]))]
        service.holdNext = true
        model.update(Self.filters("old"))
        await eventually("first request sent") { service.requests.count == 1 }
        model.update(Self.filters("new"))
        await eventually("newer results") { model.status == .results }
        service.release()
        try await Task.sleep(for: .milliseconds(20))
        #expect(model.results?.items.map(\.key) == ["personal:new"])
        #expect(model.answered?.query == "new")
    }

    @Test("whenTheSearchIsCancelled_ActivitySearch_ShouldDropItsAnswerAndStartAgainOnTheNextUpdate")
    func cancelThenUpdate() async throws {
        service.answers = [.success(try Self.page(["personal:old"])), .success(try Self.page(["personal:new"]))]
        service.holdNext = true
        model.update(Self.filters("lunch"))
        await eventually("request sent") { service.requests.count == 1 }
        model.cancel()
        #expect(model.status == .idle)
        model.update(Self.filters("lunch"))
        await eventually("searched again") { model.status == .results }
        service.release()
        try await Task.sleep(for: .milliseconds(20))
        #expect(model.results?.items.map(\.key) == ["personal:new"])
        #expect(service.requests.count == 2)
    }

    @Test("whenALedgerChangeLandsDuringTheSearch_ActivitySearch_ShouldSearchAgain")
    func searchAgain() async throws {
        service.answers = [.success(try Self.page(["personal:lunch"])), .success(try Self.page([]))]
        service.reconciliations = [.searchAgain]
        model.update(Self.filters("lunch"))
        await eventually("searched again") { model.status == .results }
        #expect(service.requests.count == 2)
        #expect(model.results?.items.isEmpty == true, "the stale page is never shown")

        service.answers = [.success(try Self.page(["personal:lunch"]))]
        service.searchEpoch += 1
        model.update(Self.filters("lunch"))
        await eventually("a save or sync searches again") { service.requests.count == 3 }
    }

    @Test(
        "whenChangesArePendingOrTheDeviceIsOffline_ActivitySearch_ShouldSearchThisDeviceAndSayWhy",
        arguments: [DeviceSearchReason.pendingChanges, .offline])
    func deviceOnly(reason: DeviceSearchReason) {
        service.reason = reason
        model.update(Self.filters("lunch"))
        #expect(model.source == .device(reason))
        #expect(service.requests.isEmpty, "local rows are never mixed into server pages")
    }

    @Test("whenReconcileSaysLocal_ActivitySearch_ShouldDropThePage")
    func reconcileLocal() async throws {
        service.answers = [.success(try Self.page(["personal:lunch"]))]
        service.reconciliations = [.useLocalResults]
        model.update(Self.filters("lunch"))
        await eventually("local") { model.source != .server }
        #expect(model.results == nil)
        #expect(model.source == .device(.pendingChanges))
    }

    @Test("whenTheServerHasNoSearch_ActivitySearch_ShouldUseThisDeviceFromThenOn")
    func notFound() async throws {
        service.answers = [.failure(APIError.notFound(message: nil))]
        model.update(Self.filters("lunch"))
        await eventually("fallback") { model.source == .device(.serverWithoutSearch) }
        model.update(Self.filters("dinner"))
        #expect(service.requests.count == 1, "a server without search is not asked again")
        #expect(model.source == .device(.serverWithoutSearch))
    }

    @Test("whenTheServerFails_ActivitySearch_ShouldExplainAndRetry")
    func failureAndRetry() async throws {
        service.answers = [.failure(APIError.unavailable(retryAfter: 2, message: nil))]
        model.update(Self.filters("lunch"))
        await eventually("failed") { model.status != .searching }
        #expect(model.status == .failed("Search took too long on your server. Try again in a moment."))
        #expect(model.source == .device(.serverFailed("Search took too long on your server. Try again in a moment.")))

        service.answers = [.success(try Self.page(["personal:lunch"]))]
        model.retry()
        await eventually("retried") { model.status == .results }
        #expect(service.requests.count == 2)
    }

    @Test("whenPagingThroughResults_ActivitySearch_ShouldAppendEachResultOnceAndStop")
    func paging() async throws {
        service.answers = [.success(try Self.page(["personal:a", "shared:b"], cursor: "c1"))]
        service.nextPages = [try Self.page(["shared:b", "personal:c"], cursor: "c2"), nil]
        model.update(Self.filters("lunch"))
        await eventually("first page") { model.status == .results }
        #expect(model.hasMore)
        model.loadMore()
        await eventually("second page") { !model.isLoadingMore }
        #expect(model.results?.items.map(\.key) == ["personal:a", "shared:b", "personal:c"])
        #expect(model.hasMore)
        model.loadMore()
        await eventually("no more") { !model.hasMore }
        #expect(model.results?.items.count == 3)
    }

    @Test("whenServerRowsAreShown_ActivitySearch_ShouldUseThisDevicesEntriesAndApplyTheCategory")
    func rows() async throws {
        service.answers = [.success(try Self.page(["personal:lunch", "shared:dinner", "personal:gone"]))]
        model.update(Self.filters("lunch"))
        await eventually("results") { model.status == .results }
        var local = Offline.entry("lunch", title: "Lunch with Sam")
        local.note = "Edited here"
        let ledger = Offline.ledger([local])
        let (rows, report) = model.rows(in: ledger)
        #expect(rows.map(\.id).contains("lunch"))
        #expect(rows.first { $0.id == "lunch" }?.title == "Lunch with Sam", "the device's version opens for Edit")
        #expect(rows.contains { $0.id == "household:h1:dinner" })
        #expect(rows.contains { $0.id == "gone" }, "a server entry this device lacks still shows")
        #expect(report.categories.contains { $0.name == "Food" && $0.id.hasPrefix("household-category:") })

        // search v1 has no category filter: the rows apply it.
        let byCategory = ActivitySearchModel(service: service, debounce: .zero)
        service.answers = [.success(try Self.page(["personal:lunch", "shared:dinner"]))]
        var food = Self.filters("lunch")
        food.categoryId = "food"
        byCategory.update(food)
        await eventually("category results") { byCategory.status == .results }
        #expect(byCategory.rows(in: ledger).rows.map(\.id) == ["lunch"])
    }
}
