import Foundation
import PennyData
import PennyDomain
import Testing

@Suite("Shared expenses in Activity (MAZ-185)")
@MainActor
struct ActivitySharedTests {
    static let november = ActivityFilters.Period.month(MonthKey(year: 2026, month: 11) ?? MonthKey(.earliest))

    static func row(_ id: String, date: String, scheduled: Bool? = nil) -> String {
        let row = SharedProjectionTests.row(id, date: date, total: 9000, share: 3000, scheduled: scheduled)
        return row.replacingOccurrences(
            of: #""householdId":"maison""#, with: #""householdId":"maison","householdName":"Maison""#)
    }

    @Test("whenAskedForAYearOrAllTime_HouseholdProjection_ShouldSendThatPeriod")
    func request() async throws {
        let transport = StubTransport(json: #"{"transactions":[],"scheduled":[]}"#)
        let client = try APIFixtures.client(transport: transport)
        _ = try await client.householdProjection(period: .year(2026))
        _ = try await client.householdProjection(period: .allTime)
        _ = try await client.householdProjection(period: Self.november)
        #expect(transport.sent.map(\.url?.path) == Array(repeating: "/api/households/projection", count: 3))
        #expect(transport.sent.map(\.url?.query) == ["year=2026", nil, "month=2026-11"])
    }

    @Test("whenTheServerAnswers_ActivitySharedModel_ShouldGiveThePeriodsRecordedShares")
    func loads() async throws {
        let service = QueuedProjection([
            "2026-11": [
                .success(
                    try SharedProjectionTests.answer(
                        recorded: [
                            Self.row("e1", date: "2026-11-03"),
                            Self.row("outside", date: "2026-10-31"),
                            Self.row("rent:2026-11-20", date: "2026-11-20", scheduled: true),
                        ],
                        scheduled: [Self.row("gym:2026-11-25", date: "2026-11-25", scheduled: true)]))
            ]
        ])
        let model = ActivitySharedModel(service: service)
        #expect(model.isAvailable)
        await model.refresh(Self.november)
        #expect(model.status(for: Self.november) == .loaded)
        let shares = model.shares(for: Self.november, currency: .cad)
        #expect(shares.map(\.id) == ["e1"], "recorded rows in the period only")
        #expect(shares.first?.householdName == "Maison")
        #expect(model.shares(for: .year(2026), currency: .cad).isEmpty, "another period was not read")
    }

    @Test("whenOfflineWithNothingLoaded_ActivitySharedModel_ShouldSaySoAndListNoSharedRows")
    func offline() async {
        let model = ActivitySharedModel(service: QueuedProjection(["2026-11": [.failure(.offline)]]))
        await model.refresh(Self.november)
        #expect(model.status(for: Self.november) == .failed("You're offline. Shared expenses need a connection."))
        #expect(!model.hasAnswer(for: Self.november))
        #expect(model.shares(for: Self.november, currency: .cad).isEmpty)
    }

    @Test("whenARefreshFails_ActivitySharedModel_ShouldKeepTheLastAnswerAndSaySo")
    func failureKeepsRows() async throws {
        let answer = try SharedProjectionTests.answer(recorded: [Self.row("e1", date: "2026-11-03")])
        let service = QueuedProjection(["2026-11": [.success(answer), .failure(.server(status: 500, message: nil))]])
        let model = ActivitySharedModel(service: service)
        await model.refresh(Self.november)
        await model.refresh(Self.november)
        #expect(
            model.status(for: Self.november) == .failed("Shared expenses couldn't load. Pull to refresh to try again."))
        #expect(model.hasAnswer(for: Self.november))
        #expect(model.shares(for: Self.november, currency: .cad).map(\.id) == ["e1"])
    }

    @Test("whenTheServerHasNoHouseholds_ActivitySharedModel_ShouldListOnlyPersonalEntries")
    func notFound() async {
        let model = ActivitySharedModel(service: QueuedProjection(["all": [.failure(.notFound(message: nil))]]))
        await model.refresh(.allTime)
        #expect(model.status(for: .allTime) == .loaded)
        #expect(model.shares(for: .allTime, currency: .cad).isEmpty)
    }

    @Test("whenASharedWriteRefreshes_ActivitySharedModel_ShouldReadEveryLoadedPeriodAgain")
    func refreshLoaded() async throws {
        let empty = try SharedProjectionTests.answer()
        let added = try SharedProjectionTests.answer(recorded: [Self.row("new", date: "2026-11-04")])
        let service = QueuedProjection(["2026-11": [.success(empty), .success(added)], "2026": [.success(empty)]])
        let model = ActivitySharedModel(service: service)
        await model.refresh(Self.november)
        await model.refresh(.year(2026))
        await model.refreshLoaded()
        #expect(model.shares(for: Self.november, currency: .cad).map(\.id) == ["new"])
        #expect(service.asked.filter { $0 == "2026-11" }.count == 2)
        #expect(!service.asked.contains("all"), "a period never read is not asked for")
    }

    @Test("whenThereIsNoService_ActivitySharedModel_ShouldStayIdle")
    func demo() async {
        let model = ActivitySharedModel(service: nil)
        #expect(!model.isAvailable)
        await model.refresh(Self.november)
        #expect(model.status(for: Self.november) == .idle)
    }
}
