public import PennyDomain

/// A wire ledger that cannot become a domain ledger. It is never saved over local data:
/// an unknown version or value means a newer or broken peer, and writing back what this
/// build understood would destroy what it did not (docs/migration/architecture.md, ADR 003).
public enum LedgerMappingError: Error, Equatable, Sendable {
    case unsupportedVersion(Int)
    case invalidValue(field: String, value: String)
}

extension Ledger {
    /// The domain ledger for a wire ledger. Versions 1–3 are upgraded the way the server and
    /// the legacy client upgrade them (`Ledger.upgradedCategories`; missing accounts and trips
    /// become empty lists). A rule without `anchorDay` (pre-v4) anchors on its start day.
    public init(wire: WireLedger) throws(LedgerMappingError) {
        // PennyData has its own wire-format `CalendarDate` check; this is the domain value.
        func date(_ text: String, _ field: String) throws(LedgerMappingError) -> PennyDomain.CalendarDate {
            guard let date = PennyDomain.CalendarDate(text) else { throw .invalidValue(field: field, value: text) }
            return date
        }
        func kind(_ value: WireEntryKind) -> EntryKind {
            switch value {
            case .expense: .expense
            case .income: .income
            case .investment: .investment
            }
        }
        guard let currency = Currency(rawValue: wire.currency) else {
            throw .invalidValue(field: "currency", value: wire.currency)
        }
        var accounts: [PaymentAccount] = []
        for account in wire.accounts ?? [] {
            guard let type = AccountType(rawValue: account.type) else {
                throw .invalidValue(field: "accounts.type", value: account.type)
            }
            accounts.append(PaymentAccount(id: account.id, name: account.name, type: type))
        }
        var trips: [Trip] = []
        for trip in wire.trips ?? [] {
            trips.append(
                Trip(
                    id: trip.id, name: trip.name, startDate: try date(trip.startDate, "trips.startDate"),
                    endDate: try date(trip.endDate, "trips.endDate"), sharedHouseholdId: trip.sharedHouseholdId))
        }
        let wireCategories = wire.categories.map {
            LedgerCategory(id: $0.id, name: $0.name, icon: $0.icon, color: $0.color, kind: kind($0.kind))
        }
        guard let categories = Ledger.upgradedCategories(wireCategories, fromVersion: wire.version) else {
            throw .unsupportedVersion(wire.version)
        }
        var transactions: [LedgerEntry] = []
        transactions.reserveCapacity(wire.transactions.count)
        for entry in wire.transactions {
            transactions.append(
                LedgerEntry(
                    id: entry.id, title: entry.title, kind: kind(entry.kind), total: entry.total, share: entry.share,
                    categoryId: entry.categoryId, accountId: entry.accountId, tripId: entry.tripId,
                    date: try date(entry.date, "transactions.date"), note: entry.note,
                    receipt: entry.receipt.map {
                        ReceiptReference(id: $0.id, name: $0.name, uri: $0.uri, mime: $0.mime)
                    },
                    recurringId: entry.recurringId))
        }
        var recurring: [RecurringRule] = []
        for rule in wire.recurring {
            guard let frequency = RecurrenceFrequency(rawValue: rule.frequency) else {
                throw .invalidValue(field: "recurring.frequency", value: rule.frequency)
            }
            let start = try date(rule.date, "recurring.date")
            recurring.append(
                RecurringRule(
                    id: rule.id, title: rule.title, kind: kind(rule.kind), total: rule.total, share: rule.share,
                    categoryId: rule.categoryId, accountId: rule.accountId, date: start, note: rule.note,
                    frequency: frequency, nextDate: try date(rule.nextDate, "recurring.nextDate"),
                    anchorDay: rule.anchorDay ?? start.day, active: rule.active))
        }
        self.init(
            currency: currency, accounts: accounts, trips: trips, categories: categories, transactions: transactions,
            recurring: recurring)
    }
}

extension WireLedger {
    /// The version 4 wire ledger for a domain ledger. Optional fields that are nil are
    /// omitted, never sent as JSON `null` (docs/migration/ledger.md).
    public init(_ ledger: Ledger) {
        func kind(_ value: EntryKind) -> WireEntryKind {
            switch value {
            case .expense: .expense
            case .income: .income
            case .investment: .investment
            }
        }
        self.init(
            version: Ledger.version, currency: ledger.currency.rawValue,
            categories: ledger.categories.map {
                WireCategory(id: $0.id, name: $0.name, icon: $0.icon, color: $0.color, kind: kind($0.kind))
            },
            accounts: ledger.accounts.map { WireAccount(id: $0.id, name: $0.name, type: $0.type.rawValue) },
            trips: ledger.trips.map {
                WireTrip(
                    id: $0.id, name: $0.name, startDate: $0.startDate.description, endDate: $0.endDate.description,
                    sharedHouseholdId: $0.sharedHouseholdId)
            },
            transactions: ledger.transactions.map {
                WireEntry(
                    id: $0.id, title: $0.title, kind: kind($0.kind), total: $0.total, share: $0.share,
                    categoryId: $0.categoryId, accountId: $0.accountId, tripId: $0.tripId, recurringId: $0.recurringId,
                    date: $0.date.description, note: $0.note,
                    receipt: $0.receipt.map { WireReceipt(id: $0.id, name: $0.name, mime: $0.mime, uri: $0.uri) })
            },
            recurring: ledger.recurring.map {
                WireRecurring(
                    id: $0.id, title: $0.title, kind: kind($0.kind), total: $0.total, share: $0.share,
                    categoryId: $0.categoryId, accountId: $0.accountId, date: $0.date.description, note: $0.note,
                    frequency: $0.frequency.rawValue, nextDate: $0.nextDate.description, anchorDay: $0.anchorDay,
                    active: $0.active)
            })
    }
}
