/// How a shared expense is divided (wire values of `splitMode`).
public enum SharedSplitMode: String, CaseIterable, Hashable, Sendable {
    case equal
    case exact
    case percent
}

/// One member's part of a shared expense, in integer cents.
public struct SharedShare: Hashable, Sendable {
    public var userId: String
    public var amountCents: Int64

    public init(userId: String, amountCents: Int64) {
        self.userId = userId
        self.amountCents = amountCents
    }
}

/// The server's shared-expense split (`HouseholdSplits`, src/domain `calculateHouseholdSplits`),
/// so the form previews exactly what the server will store. The
/// server still decides: it recomputes the split and rejects one that doesn't add up. Golden
/// cases: `contracts/fixtures/shared-splits.json`.
///
/// Integer cents only. Members are ordered by id (ordinal, as the server's `string.CompareOrdinal`).
public enum HouseholdSplit {
    public static let maxTotal: Int64 = 99_999_999_999
    /// 100% in basis points.
    public static let wholeBasisPoints: Int64 = 10_000

    public enum Failure: Error, Equatable, Sendable {
        /// The total is outside 1...maxTotal.
        case invalidTotal
        /// No members, or a member listed twice (`Select distinct members.`).
        case members
        /// Amounts or percentages that don't add up to the total or 100%
        /// (`Split shares must add up to the expense total.`).
        case doesNotAddUp
        /// A negative amount or a percentage outside 0...100%.
        case invalidValue
    }

    /// Equal: `floor(total / n)` each, and the `total mod n` remaining cents one each to the
    /// lexically first members. 100.00 among three is 33.34, 33.33, 33.33.
    public static func equal(total: Int64, memberIds: [String]) throws(Failure) -> [SharedShare] {
        let ids = try distinct(memberIds)
        guard (1...maxTotal).contains(total) else { throw .invalidTotal }
        let count = Int64(ids.count)
        let each = total / count
        let remainder = total % count
        return ids.enumerated().map { index, id in
            SharedShare(userId: id, amountCents: each + (Int64(index) < remainder ? 1 : 0))
        }
    }

    /// Exact: the given amounts (zero allowed), which must add up to the total exactly.
    public static func exact(total: Int64, amounts: [String: Int64]) throws(Failure) -> [SharedShare] {
        _ = try distinct(Array(amounts.keys))
        guard (1...maxTotal).contains(total) else { throw .invalidTotal }
        guard amounts.values.allSatisfy({ $0 >= 0 }) else { throw .invalidValue }
        var sum: Int64 = 0
        for value in amounts.values {
            let (next, overflow) = sum.addingReportingOverflow(value)
            guard !overflow else { throw .doesNotAddUp }
            sum = next
        }
        guard sum == total else { throw .doesNotAddUp }
        return amounts.keys.sorted().map { SharedShare(userId: $0, amountCents: amounts[$0] ?? 0) }
    }

    /// Percentage in basis points (10000 = 100%), which must add up to 10000. Each share is
    /// `floor(total × points / 10000)`, computed without an intermediate above the total; the
    /// cents left over go one each to the largest fractional remainders, ties to the lower id.
    public static func percent(total: Int64, basisPoints: [String: Int64]) throws(Failure) -> [SharedShare] {
        _ = try distinct(Array(basisPoints.keys))
        guard (1...maxTotal).contains(total) else { throw .invalidTotal }
        guard basisPoints.values.allSatisfy({ (0...wholeBasisPoints).contains($0) }) else { throw .invalidValue }
        guard basisPoints.values.reduce(0, +) == wholeBasisPoints else { throw .doesNotAddUp }
        let quotient = total / wholeBasisPoints
        let remainder = total % wholeBasisPoints
        var shares: [(id: String, cents: Int64, leftover: Int64)] = basisPoints.keys.sorted().map { id in
            let points = basisPoints[id] ?? 0
            let minor = remainder * points
            return (id, quotient * points + minor / wholeBasisPoints, minor % wholeBasisPoints)
        }
        var left = total - shares.reduce(0) { $0 + $1.cents }
        let order = shares.indices.sorted {
            shares[$0].leftover != shares[$1].leftover
                ? shares[$0].leftover > shares[$1].leftover : shares[$0].id < shares[$1].id
        }
        for index in order where left > 0 {
            shares[index].cents += 1
            left -= 1
        }
        return shares.map { SharedShare(userId: $0.id, amountCents: $0.cents) }
    }

    /// Parses a percentage someone typed ("33.33", "50", "12,5", "25%") into basis points,
    /// 0...10000. Nil for anything else.
    public static func basisPoints(_ input: String) -> Int64? {
        var text = JavaScriptText.trim(input)
        if text.hasSuffix("%") { text = JavaScriptText.trim(String(text.dropLast())) }
        guard let points = try? Money.cents(text), points <= wholeBasisPoints else { return nil }
        return points
    }

    /// Basis points as a percentage for a text field ("33.33", "50").
    public static func percentText(_ points: Int64) -> String {
        let whole = points / 100
        let fraction = points % 100
        guard fraction != 0 else { return "\(whole)" }
        return fraction % 10 == 0 ? "\(whole).\(fraction / 10)" : "\(whole).\(fraction < 10 ? "0" : "")\(fraction)"
    }

    private static func distinct(_ ids: [String]) throws(Failure) -> [String] {
        guard !ids.isEmpty, Set(ids).count == ids.count, ids.allSatisfy({ !$0.isEmpty }) else { throw .members }
        return ids.sorted()
    }
}

/// Settlement timing (MAZ-58), mirrored only to explain the wait; the server decides.
public enum SettlementCalendar {
    /// A month can be settled with a monthly payment from its last calendar day (UTC) on.
    public static func monthlyPaymentsOpen(_ month: MonthKey, todayUTC: CalendarDate) -> Bool {
        todayUTC >= month.last
    }

    /// The person's offset in the JavaScript `Date#getTimezoneOffset` sense (minutes behind
    /// UTC: Toronto in winter is 300), clamped to the contract's −840...720. The server records
    /// the local join day from it, so someone joining at 9:30 p.m. can share that day's expenses.
    public static func timezoneOffsetMinutes(secondsFromGMT: Int) -> Int {
        min(720, max(-840, -secondsFromGMT / 60))
    }
}

/// Text rules the shared-expense server applies: JavaScript's `trim`
/// whitespace set, and lengths in UTF-16 units.
public enum SharedText {
    public static func trimmed(_ text: String) -> String { JavaScriptText.trim(text) }

    /// Trimmed and 1...`maxLength` UTF-16 units, or nil.
    public static func required(_ text: String, maxLength: Int) -> String? {
        let value = trimmed(text)
        return (1...maxLength).contains(value.utf16.count) ? value : nil
    }
}
