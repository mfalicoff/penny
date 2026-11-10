import Foundation
import PennyContracts
import PennyDomain
import Testing

/// Maps the strict `PennyContracts` wire models onto domain values, so the golden fixtures
/// drive the Swift rules. Mapping is test-only: production decoding is PennyData's (MAZ-67).
enum ContractLedger {
    static func date(_ text: String) throws -> CalendarDate {
        try #require(CalendarDate(text), "\(text) is not a calendar date")
    }

    static func kind(_ text: String) throws -> EntryKind {
        try #require(EntryKind(rawValue: text), "\(text) is not an entry kind")
    }

    static func ledger(_ wire: PennyContracts.Ledger) throws -> PennyDomain.Ledger {
        PennyDomain.Ledger(
            currency: try #require(Currency(rawValue: wire.currency)),
            accounts: try (wire.accounts ?? []).map {
                PaymentAccount(id: $0.id, name: $0.name, type: try #require(AccountType(rawValue: $0.type)))
            },
            trips: try (wire.trips ?? []).map {
                Trip(
                    id: $0.id, name: $0.name, startDate: try date($0.startDate), endDate: try date($0.endDate),
                    sharedHouseholdId: $0.sharedHouseholdId)
            },
            categories: try wire.categories.map {
                LedgerCategory(id: $0.id, name: $0.name, icon: $0.icon, color: $0.color, kind: try kind($0.kind))
            },
            transactions: try wire.transactions.map(entry),
            recurring: try wire.recurring.map {
                RecurringRule(
                    id: $0.id, title: $0.title, kind: try kind($0.kind), total: $0.total, share: $0.share,
                    categoryId: $0.categoryId, accountId: $0.accountId, date: try date($0.date), note: $0.note,
                    frequency: try #require(RecurrenceFrequency(rawValue: $0.frequency)),
                    nextDate: try date($0.nextDate), anchorDay: $0.anchorDay, active: $0.active)
            })
    }

    static func entry(_ wire: PennyContracts.Ledger.Entry) throws -> LedgerEntry {
        LedgerEntry(
            id: wire.id, title: wire.title, kind: try kind(wire.kind), total: wire.total, share: wire.share,
            categoryId: wire.categoryId, accountId: wire.accountId, tripId: wire.tripId, date: try date(wire.date),
            note: wire.note, recurringId: wire.recurringId)
    }

    /// The `searchable-household` seed: alex's personal ledger as written in its first step.
    static func alexSeed() throws -> (scenario: SeedFixture.Scenario, ledger: PennyDomain.Ledger) {
        let seeds = try Fixtures.decode(SeedFixture.self, from: "full-stack-seeds.json")
        let scenario = try #require(seeds.scenarios.first { $0.name == "searchable-household" })
        let step = try #require(scenario.steps.first { $0["as"] == .string("alex") && $0["ledger"] != nil })
        let data = try JSONEncoder().encode(try #require(step["ledger"]))
        return (scenario, try ledger(JSONDecoder().decode(PennyContracts.Ledger.self, from: data)))
    }
}

/// search-cases.json has no strict Swift model in PennyContracts yet (its Swift consumer is
/// listed as MAZ-73), so the legacy local parts are read with a lenient one here.
struct LocalSearchCases: Decodable {
    struct SubstringCase: Decodable {
        var query: String
        var kind: String?
        var day: String?
        var page: Int?
        var ids: [String]
        var totalCount: Int?
    }

    struct PendingCase: Decodable {
        var name: String
        var localCreate: PennyContracts.Ledger.Entry?
        var editId: String?
        var patch: [String: String]?
        var deleteId: String?
        var query: String
        var expectedIds: [String]
    }

    var ledger: PennyContracts.Ledger
    var substringCases: [SubstringCase]
    var pendingCases: [PendingCase]

    static func load() throws -> LocalSearchCases {
        try JSONDecoder().decode(LocalSearchCases.self, from: Fixtures.data("search-cases.json"))
    }
}

extension CalendarDate {
    /// A literal test date; traps on a typo, which the test would catch anyway.
    static func day(_ text: String) -> CalendarDate {
        guard let date = CalendarDate(text) else { preconditionFailure("\(text) is not a calendar date") }
        return date
    }
}

/// A small ledger for command and report tests.
enum Sample {
    static let visa = PaymentAccount(id: "visa", name: "Visa", type: .credit)
    static let lisbon = Trip(id: "lisbon", name: "Lisbon", startDate: .day("2026-11-02"), endDate: .day("2026-11-08"))

    static func entry(
        _ id: String, _ date: String, share: Int64 = 1000, total: Int64? = nil, kind: EntryKind = .expense,
        category: String? = nil, title: String = "Coffee", note: String = "", accountId: String? = nil,
        tripId: String? = nil, recurringId: String? = nil
    ) -> LedgerEntry {
        LedgerEntry(
            id: id, title: title, kind: kind, total: total ?? share, share: share,
            categoryId: category ?? defaultCategory(kind), accountId: accountId, tripId: tripId, date: .day(date),
            note: note, recurringId: recurringId)
    }

    static func rule(
        _ id: String, start: String, next: String? = nil, frequency: RecurrenceFrequency = .monthly,
        anchorDay: Int? = nil, share: Int64 = 4000, kind: EntryKind = .expense, active: Bool = true,
        accountId: String? = nil
    ) -> RecurringRule {
        let date = CalendarDate.day(start)
        return RecurringRule(
            id: id, title: "Rule \(id)", kind: kind, total: share, share: share, categoryId: defaultCategory(kind),
            accountId: accountId, date: date, frequency: frequency, nextDate: .day(next ?? start),
            anchorDay: anchorDay ?? date.day, active: active)
    }

    static func defaultCategory(_ kind: EntryKind) -> String {
        switch kind {
        case .expense: "food"
        case .income: "salary"
        case .investment: "investments"
        }
    }

    static func ledger(transactions: [LedgerEntry] = [], recurring: [RecurringRule] = []) -> PennyDomain.Ledger {
        PennyDomain.Ledger(accounts: [visa], trips: [lisbon], transactions: transactions, recurring: recurring)
    }
}
