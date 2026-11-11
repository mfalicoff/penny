import Foundation
import PennyData
import PennyDomain
import Synchronization
import Testing

/// Answers queued per month; a month with no queued answer throws `error`.
private final class QueuedProjection: SharedProjectionService {
    private let answers: Mutex<[String: [Result<WireHouseholdProjection, APIError>]]>
    private let calls = Mutex<[String]>([])

    init(_ answers: [String: [Result<WireHouseholdProjection, APIError>]]) {
        self.answers = Mutex(answers)
    }

    var asked: [String] { calls.withLock { $0 } }

    func projection(month: MonthKey) async throws -> WireHouseholdProjection {
        calls.withLock { $0.append("\(month)") }
        let next = answers.withLock { queue -> Result<WireHouseholdProjection, APIError> in
            guard var list = queue["\(month)"], !list.isEmpty else { return .failure(.unreachable) }
            let first = list.removeFirst()
            queue["\(month)"] = list
            return first
        }
        return try next.get()
    }
}

@Suite("Household projection for Home")
@MainActor
struct SharedProjectionTests {
    static let november = MonthKey(year: 2026, month: 11) ?? MonthKey(.earliest)
    static let october = MonthKey(year: 2026, month: 10) ?? MonthKey(.earliest)

    /// One projected row as both servers send it. Fixture values only.
    static func row(
        _ id: String, date: String, total: Int64, share: Int64, scheduled: Bool? = nil, recurringId: String? = nil,
        currency: String? = "CAD"
    ) -> String {
        var fields = [
            #""id":"\#(id)""#, #""householdId":"maison""#, #""title":"Groceries""#, #""date":"\#(date)""#,
            #""totalCents":\#(total)"#, #""shareCents":\#(share)"#, #""payerUserId":"user-a""#,
            ##""category":{"name":"Groceries","icon":"basket-outline","color":"#0FA3A3"}"##, #""note":"""#,
        ]
        if let currency { fields.append(#""householdCurrency":"\#(currency)""#) }
        if let scheduled { fields.append(#""scheduled":\#(scheduled)"#) }
        if let recurringId { fields.append(#""recurringId":"\#(recurringId)""#) }
        return "{" + fields.joined(separator: ",") + "}"
    }

    static func answer(recorded: [String] = [], scheduled: [String] = []) throws -> WireHouseholdProjection {
        let json =
            #"{"transactions":[\#(recorded.joined(separator: ","))],"scheduled":[\#(scheduled.joined(separator: ","))]}"#
        return try JSONDecoder().decode(WireHouseholdProjection.self, from: Data(json.utf8))
    }

    @Test("whenAskedForAMonth_HouseholdProjection_ShouldSendAnAuthenticatedGETWithTheMonth")
    func request() async throws {
        let transport = StubTransport(json: #"{"transactions":[],"scheduled":[]}"#)
        let projection = try await APIFixtures.client(transport: transport).householdProjection(month: Self.november)
        #expect(projection == WireHouseholdProjection())
        let sent = try #require(transport.sent.first)
        #expect(sent.httpMethod == "GET")
        #expect(sent.url?.path == "/api/households/projection")
        #expect(sent.url?.query == "month=2026-11")
        #expect(sent.value(forHTTPHeaderField: "Authorization") == "Bearer \(APIFixtures.token)")
    }

    @Test("whenTheServerAnswers_SharedProjectionModel_ShouldGiveSharesForTheReportOnce")
    func loads() async throws {
        let shared = Self.row("e1", date: "2026-11-03", total: 9000, share: 3000)
        let preview = Self.row(
            "rent:2026-11-20", date: "2026-11-20", total: 200_000, share: 100_000, scheduled: true,
            recurringId: "rent")
        let service = QueuedProjection([
            "2026-10": [.success(try Self.answer(recorded: [shared]))],
            "2026-11": [.success(try Self.answer(recorded: [shared], scheduled: [preview]))],
        ])
        let model = SharedProjectionModel(service: service)
        #expect(model.isAvailable)
        await model.refresh(Self.november)
        await model.refresh(Self.october)
        #expect(model.status(for: Self.november) == .loaded)
        let rows = model.shares(currency: .cad)
        #expect(rows.recorded.count == 2, "the same row from two months' answers; the report keeps one")
        #expect(rows.scheduled.map(\.id) == ["rent:2026-11-20"])
        #expect(rows.scheduled.allSatisfy { $0.scheduled })
        let report = LedgerReport(ledger: Ledger(), shared: rows.recorded, sharedScheduled: rows.scheduled)
        let summary = report.month(Self.november)
        #expect(summary.recorded.expense == 3000, "the viewer's share, once")
        #expect(summary.projected.expense == 103_000)
    }

    @Test("whenARefreshFails_SharedProjectionModel_ShouldKeepTheLastAnswerAndSaySo")
    func failureKeepsRows() async throws {
        let shared = Self.row("e1", date: "2026-11-03", total: 9000, share: 3000)
        let service = QueuedProjection(["2026-11": [.success(try Self.answer(recorded: [shared])), .failure(.offline)]])
        let model = SharedProjectionModel(service: service)
        await model.refresh(Self.november)
        let revision = model.revision
        await model.refresh(Self.november)
        #expect(
            model.status(for: Self.november)
                == .failed("You're offline. Shared expenses update when you're back online."))
        #expect(model.shares(currency: .cad).recorded.count == 1)
        #expect(model.revision == revision, "nothing changed, so a cached report stays valid")
    }

    @Test("whenTheServerHasNoHouseholds_SharedProjectionModel_ShouldShowThePersonalMonth")
    func notFound() async throws {
        let model = SharedProjectionModel(service: QueuedProjection(["2026-11": [.failure(.notFound(message: nil))]]))
        await model.refresh(Self.november)
        #expect(model.status(for: Self.november) == .loaded)
        #expect(model.shares(currency: .cad).recorded.isEmpty)
    }

    @Test("whenARowCantBeRead_SharedProjectionModel_ShouldLeaveItOut")
    func unreadable() async throws {
        let model = SharedProjectionModel(
            service: QueuedProjection([
                "2026-11": [
                    .success(
                        try Self.answer(recorded: [
                            Self.row("bad-date", date: "2026-11-31", total: 100, share: 50),
                            Self.row("other-currency", date: "2026-11-02", total: 100, share: 50, currency: "JPY"),
                            Self.row("no-currency", date: "2026-11-02", total: 100, share: 50, currency: nil),
                        ]))
                ]
            ]))
        await model.refresh(Self.november)
        #expect(model.shares(currency: .eur).recorded.map(\.id) == ["no-currency"])
        #expect(model.shares(currency: .eur).recorded.first?.currency == .eur, "a missing currency is the ledger's")
    }

    @Test("whenThereIsNoService_SharedProjectionModel_ShouldStayIdleWithNoRows")
    func demo() async {
        let model = SharedProjectionModel(service: nil)
        #expect(!model.isAvailable)
        await model.refresh(Self.november)
        #expect(model.status(for: Self.november) == .idle)
        #expect(model.shares(currency: .cad).recorded.isEmpty)
    }
}
