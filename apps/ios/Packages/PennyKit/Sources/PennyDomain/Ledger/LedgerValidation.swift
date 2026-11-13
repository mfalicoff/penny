/// A reason the server would refuse a ledger as "Invalid ledger data." (the .NET
/// `LedgerReader`; docs/reference/ledger.md).
public enum LedgerViolation: Hashable, Sendable {
    case invalidID(String)
    case duplicateID(String)
    case tooMany(String)
    case invalidName(String)
    case invalidText(String)
    case invalidColor(String)
    case dateOutOfRange(String)
    case invalidAmounts(String)
    case invalidShare(String)
    case invalidCategory(String)
    case invalidAccount(String)
    case invalidTrip(String)
    case invalidTripDates(String)
    case invalidAnchorDay(String)
}

extension Ledger {
    /// Every structural rule the ledger write endpoint enforces on its own (it also has
    /// server-only checks: household currency, linked accounts, receipt ownership, revision).
    /// Typed values already guarantee the enumerations and real calendar days, so this checks
    /// the rest. A client runs it before it acknowledges a save, so an edit that could never
    /// sync is refused while the person still has the form open. Empty means valid.
    ///
    /// Every string field also has to be storable (.NET `LedgerText.IsStorable`): a NUL is
    /// refused, as on the server. The rule's other half, unpaired UTF-16 surrogates, cannot be
    /// represented in a Swift `String`, so the type already guarantees it.
    public var violations: [LedgerViolation] {
        var found: [LedgerViolation] = []
        /// A length in UTF-16 code units within `range`, plus `IsStorable`, on the string itself.
        func text(_ value: String, _ range: ClosedRange<Int>) -> Bool {
            range.contains(JavaScriptText.length(value)) && JavaScriptText.isStorable(value)
        }
        func id(_ value: String, _ list: String) {
            if !text(value, 1...Ledger.maxIDLength) { found.append(.invalidID(list)) }
        }
        // Ids compare as UTF-16 code units on the server (`StringComparer.Ordinal`); a Swift
        // `Set<String>` would merge canonically equivalent ids, so uniqueness is checked on the
        // code units. Lengths are checked on the ids themselves.
        func unique(_ ids: [String], _ list: String) {
            if Set(ids.map { Array($0.utf16) }).count != ids.count { found.append(.duplicateID(list)) }
            for value in ids { id(value, list) }
        }
        func date(_ value: CalendarDate, _ owner: String) {
            if !value.isWithinLedgerRange { found.append(.dateOutOfRange(owner)) }
        }

        if accounts.count > Ledger.maxAccounts { found.append(.tooMany("accounts")) }
        if trips.count > Ledger.maxTrips { found.append(.tooMany("trips")) }
        if categories.count > Ledger.maxCategories { found.append(.tooMany("categories")) }
        if transactions.count > Ledger.maxEntries { found.append(.tooMany("transactions")) }
        if recurring.count > Ledger.maxRules { found.append(.tooMany("recurring")) }

        unique(accounts.map(\.id), "accounts")
        unique(trips.map(\.id), "trips")
        unique(categories.map(\.id), "categories")
        unique(transactions.map(\.id), "transactions")
        unique(recurring.map(\.id), "recurring")

        // Names are trimmed before their length is checked; trimming never removes a NUL.
        for account in accounts where !text(JavaScriptText.trim(account.name), 1...50) {
            found.append(.invalidName(account.id))
        }
        for trip in trips {
            if !text(JavaScriptText.trim(trip.name), 1...80) { found.append(.invalidName(trip.id)) }
            date(trip.startDate, trip.id)
            date(trip.endDate, trip.id)
            if trip.endDate < trip.startDate { found.append(.invalidTripDates(trip.id)) }
            if let household = trip.sharedHouseholdId { id(household, "trips") }
        }
        for category in categories {
            if !text(category.name, 1...50) { found.append(.invalidName(category.id)) }
            if !text(category.icon, 0...80) { found.append(.invalidText(category.id)) }
            if !Ledger.isHexColor(category.color) { found.append(.invalidColor(category.id)) }
        }

        let accountIDs = Set(accounts.map(\.id))
        let tripIDs = Set(trips.map(\.id))
        // A duplicate id is already a violation; the last one wins.
        let kinds = Dictionary(categories.map { ($0.id, $0.kind) }, uniquingKeysWith: { _, last in last })
        func amounts(
            _ owner: String, kind: EntryKind, total: Int64, share: Int64, categoryId: String, accountId: String?,
            title: String, note: String, on day: CalendarDate
        ) {
            if !text(title, 1...100) || !text(note, 0...1000) { found.append(.invalidText(owner)) }
            if !Money.isValidAmounts(total: total, share: share) { found.append(.invalidAmounts(owner)) }
            if kind != .expense, share != total { found.append(.invalidShare(owner)) }
            if kinds[categoryId] != kind { found.append(.invalidCategory(owner)) }
            id(categoryId, owner)
            if let accountId {
                id(accountId, owner)
                if !accountIDs.contains(accountId) { found.append(.invalidAccount(owner)) }
            }
            date(day, owner)
        }
        for entry in transactions {
            amounts(
                entry.id, kind: entry.kind, total: entry.total, share: entry.share, categoryId: entry.categoryId,
                accountId: entry.accountId, title: entry.title, note: entry.note, on: entry.date)
            if let tripId = entry.tripId, entry.kind != .expense || !tripIDs.contains(tripId) {
                found.append(.invalidTrip(entry.id))
            }
            if let recurringId = entry.recurringId { id(recurringId, entry.id) }
            if let receipt = entry.receipt {
                id(receipt.id, entry.id)
                if !text(receipt.name, 0...255) || !text(receipt.mime, 0...100) || !text(receipt.uri, 0...500) {
                    found.append(.invalidText(entry.id))
                }
            }
        }
        for rule in recurring {
            amounts(
                rule.id, kind: rule.kind, total: rule.total, share: rule.share, categoryId: rule.categoryId,
                accountId: rule.accountId, title: rule.title, note: rule.note, on: rule.date)
            date(rule.nextDate, rule.id)
            if !(1...31).contains(rule.anchorDay) { found.append(.invalidAnchorDay(rule.id)) }
        }
        return found
    }

    /// `#RRGGBB` with ASCII hex digits, either case.
    static func isHexColor(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        return bytes.count == 7 && bytes[0] == 0x23
            && bytes[1...].allSatisfy {
                (0x30...0x39).contains($0) || (0x41...0x46).contains($0) || (0x61...0x66).contains($0)
            }
    }
}
