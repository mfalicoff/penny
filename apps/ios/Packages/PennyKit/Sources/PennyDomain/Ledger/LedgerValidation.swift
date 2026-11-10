/// A reason the server would refuse a ledger as "Invalid ledger data." (the legacy zod schema
/// and refinements, ported by the .NET `LedgerReader`; docs/migration/ledger.md).
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
    public var violations: [LedgerViolation] {
        var found: [LedgerViolation] = []
        func id(_ value: String, _ list: String) {
            if !(1...100).contains(JavaScriptText.length(value)) { found.append(.invalidID(list)) }
        }
        func unique(_ ids: [String], _ list: String) {
            if Set(ids).count != ids.count { found.append(.duplicateID(list)) }
            for value in ids { id(value, list) }
        }
        func date(_ value: CalendarDate, _ owner: String) {
            if !value.isWithinLedgerRange { found.append(.dateOutOfRange(owner)) }
        }
        // Ids compare as code units on the server; Swift `Set<String>` would merge canonically
        // equivalent ids, so uniqueness is checked on the UTF-16 form.
        func codeUnits(_ values: [String]) -> [String] {
            values.map { $0.utf16.map(String.init).joined(separator: ",") }
        }

        if accounts.count > Ledger.maxAccounts { found.append(.tooMany("accounts")) }
        if trips.count > Ledger.maxTrips { found.append(.tooMany("trips")) }
        if categories.count > Ledger.maxCategories { found.append(.tooMany("categories")) }
        if transactions.count > Ledger.maxEntries { found.append(.tooMany("transactions")) }
        if recurring.count > Ledger.maxRules { found.append(.tooMany("recurring")) }

        unique(codeUnits(accounts.map(\.id)), "accounts")
        unique(codeUnits(trips.map(\.id)), "trips")
        unique(codeUnits(categories.map(\.id)), "categories")
        unique(codeUnits(transactions.map(\.id)), "transactions")
        unique(codeUnits(recurring.map(\.id)), "recurring")

        for account in accounts where !(1...50).contains(JavaScriptText.length(JavaScriptText.trim(account.name))) {
            found.append(.invalidName(account.id))
        }
        for trip in trips {
            if !(1...80).contains(JavaScriptText.length(JavaScriptText.trim(trip.name))) {
                found.append(.invalidName(trip.id))
            }
            date(trip.startDate, trip.id)
            date(trip.endDate, trip.id)
            if trip.endDate < trip.startDate { found.append(.invalidTripDates(trip.id)) }
            if let household = trip.sharedHouseholdId { id(household, "trips") }
        }
        for category in categories {
            if !(1...50).contains(JavaScriptText.length(category.name)) { found.append(.invalidName(category.id)) }
            if JavaScriptText.length(category.icon) > 80 { found.append(.invalidText(category.id)) }
            if !Ledger.isHexColor(category.color) { found.append(.invalidColor(category.id)) }
        }

        let accountIDs = Set(accounts.map(\.id))
        let tripIDs = Set(trips.map(\.id))
        // A duplicate id is already a violation; the last one wins, as in the legacy `Map`.
        let kinds = Dictionary(categories.map { ($0.id, $0.kind) }, uniquingKeysWith: { _, last in last })
        func amounts(
            _ owner: String, kind: EntryKind, total: Int64, share: Int64, categoryId: String, accountId: String?,
            title: String, note: String, on day: CalendarDate
        ) {
            if !(1...100).contains(JavaScriptText.length(title)) || JavaScriptText.length(note) > 1000 {
                found.append(.invalidText(owner))
            }
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
                if JavaScriptText.length(receipt.name) > 255 || JavaScriptText.length(receipt.mime) > 100
                    || JavaScriptText.length(receipt.uri) > 500
                {
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

    /// The categories after upgrading a version 1–3 ledger to version 4 (legacy `upgradeLedger`).
    ///
    /// Only version 1 changes: it gains the Investments category, with id `investments`, or
    /// `investments-1`, `-2`… on a collision, unless it already has an investment category or
    /// already has 300 categories. Versions 2–4 never gain or restore a category, and historical
    /// expenses are never reclassified. Missing accounts and trips become empty lists in the
    /// wire layer. Returns nil for an unknown version, which must never be saved.
    public static func upgradedCategories(_ categories: [LedgerCategory], fromVersion version: Int) -> [LedgerCategory]?
    {
        guard (1...4).contains(version) else { return nil }
        guard version == 1, !categories.contains(where: { $0.kind == .investment }),
            categories.count < maxCategories
        else { return categories }
        var id = investmentCategory.id
        var suffix = 1
        while categories.contains(where: { $0.id == id }) {
            id = "\(investmentCategory.id)-\(suffix)"
            suffix += 1
        }
        var category = investmentCategory
        category.id = id
        return categories + [category]
    }
}
