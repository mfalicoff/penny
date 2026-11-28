// Shared trips and households in any currency (MAZ-151 phase 2, contract 2.5.0), ported from
// apps/web/src/domain/households.ts (`memberAmounts`, `settleIn`, `suggestReimbursements`,
// `sharedExpenseCurrencyProblem`). Golden cases: contracts/fixtures/shared-currency.json
// (`SharedCurrencyTests`).
//
// A household's (or shared trip's) currency is the one its balances and settle-up use. A shared
// expense paid in another currency also carries the amount paid, that currency and the rate used
// (household units per unit); its `totalCents` and splits are that amount converted at the expense
// date's rate, so balances never move later. Each member sees the expense in their own home
// currency too (`memberAmounts`), which the server sends as `home`.

/// A shared-amount rule refused its input. `message` is the reference's sentence.
public enum SharedAmountError: Error, Hashable, Sendable, CustomStringConvertible {
    /// An amount that isn't a non-negative whole number of minor units.
    case notWholeMinorUnits
    /// A share above its total (or a zero total).
    case shareExceedsTotal
    /// Balances that list a member twice.
    case duplicateMember
    /// Balances that don't add up to zero.
    case balancesDoNotNet
    /// A conversion refused its amount, currency or rate.
    case conversion(LedgerRuleError)

    public var message: String {
        switch self {
        case .notWholeMinorUnits: "Amounts are whole minor units."
        case .shareExceedsTotal: "A share cannot exceed its total."
        case .duplicateMember: "Balances must contain each member once."
        case .balancesDoNotNet: "Household balances must net to zero."
        case .conversion(let error): error.message
        }
    }

    public var description: String { message }
}

/// A member's balance in a household's month: positive gets money back, negative owes.
public struct SharedBalance: Hashable, Sendable {
    public var userId: String
    public var balanceCents: Int64

    public init(userId: String, balanceCents: Int64) {
        self.userId = userId
        self.balanceCents = balanceCents
    }
}

/// A suggested full transfer from a debtor to a creditor.
public struct SharedTransfer: Hashable, Sendable {
    public var fromUserId: String
    public var toUserId: String
    public var amountCents: Int64

    public init(fromUserId: String, toUserId: String, amountCents: Int64) {
        self.fromUserId = fromUserId
        self.toUserId = toUserId
        self.amountCents = amountCents
    }
}

/// A member's amounts of one shared expense in their home currency (`memberAmounts`).
public struct MemberAmounts: Hashable, Sendable {
    public var totalCents: Int64
    public var shareCents: Int64

    public init(totalCents: Int64, shareCents: Int64) {
        self.totalCents = totalCents
        self.shareCents = shareCents
    }
}

public enum SharedCurrency {
    /// A member's view of a shared expense in their home currency. The expense converts from what
    /// was paid (its original amount, or its total when it was paid in the household's currency) at
    /// `rate`, the home units per unit of that currency for the expense's date, rounded once, half
    /// up. Paid in the home currency, the amount is exact and no rate is needed. The share keeps its
    /// proportion of the total (half up), so a whole share stays whole. Nil when a rate is needed
    /// and none is known: the row is then left out of home totals.
    public static func memberAmounts(
        totalCents: Int64, originalAmount: Int64?, originalCurrency: String?, shareCents: Int64,
        householdCurrency: String, home: String, rate: String?
    ) throws(SharedAmountError) -> MemberAmounts? {
        let source = originalCurrency ?? householdCurrency
        let amount = originalAmount ?? totalCents
        let total: Int64
        if householdCurrency == home {
            total = totalCents
        } else if source == home {
            total = amount
        } else if let rate {
            do {
                total = try Currencies.convertAmount(amount, from: source, rate: rate, home: home)
            } catch {
                throw .conversion(error)
            }
        } else {
            return nil
        }
        return MemberAmounts(
            totalCents: total, shareCents: try Currencies.proportionHalfUp(shareCents, of: totalCents, applied: total))
    }

    /// Greedy matching of debtors to creditors (largest first, then id), at most debtors +
    /// creditors − 1 full transfers: the server's monthly suggestions.
    public static func suggestReimbursements(_ balances: [SharedBalance]) throws(SharedAmountError)
        -> [SharedTransfer]
    {
        guard Set(balances.map { Array($0.userId.utf16) }).count == balances.count else { throw .duplicateMember }
        var sum: Int64 = 0
        for item in balances {
            let (next, overflow) = sum.addingReportingOverflow(item.balanceCents)
            guard !overflow else { throw .notWholeMinorUnits }
            sum = next
        }
        guard sum == 0 else { throw .balancesDoNotNet }
        func order(_ lhs: (userId: String, cents: Int64), _ rhs: (userId: String, cents: Int64)) -> Bool {
            lhs.cents != rhs.cents ? lhs.cents > rhs.cents : JavaScriptText.ordinalLess(lhs.userId, rhs.userId)
        }
        var debtors = balances.filter { $0.balanceCents < 0 }.map { (userId: $0.userId, cents: -$0.balanceCents) }
            .sorted(by: order)
        var creditors = balances.filter { $0.balanceCents > 0 }.map { (userId: $0.userId, cents: $0.balanceCents) }
            .sorted(by: order)
        var suggestions: [SharedTransfer] = []
        var debtorIndex = 0
        var creditorIndex = 0
        while debtorIndex < debtors.count, creditorIndex < creditors.count {
            let amount = min(debtors[debtorIndex].cents, creditors[creditorIndex].cents)
            suggestions.append(
                SharedTransfer(
                    fromUserId: debtors[debtorIndex].userId, toUserId: creditors[creditorIndex].userId,
                    amountCents: amount))
            debtors[debtorIndex].cents -= amount
            creditors[creditorIndex].cents -= amount
            if debtors[debtorIndex].cents == 0 { debtorIndex += 1 }
            if creditors[creditorIndex].cents == 0 { creditorIndex += 1 }
        }
        return suggestions
    }

    /// Balances and suggested payments shown in another currency ("Settle in"), at one rate (`to`
    /// units per unit of `from`, today's). Payments are suggested in the household's currency
    /// first, then each figure is converted on its own, half up, keeping its sign. Recording a
    /// payment still records the household-currency amount.
    public static func settleIn(_ balances: [SharedBalance], from: String, to: String, rate: String)
        throws(SharedAmountError) -> (balances: [SharedBalance], suggestions: [SharedTransfer])
    {
        let suggestions = try suggestReimbursements(balances)
        func convert(_ value: Int64) throws(SharedAmountError) -> Int64 {
            if from == to { return value }
            guard value != .min else { throw .notWholeMinorUnits }
            do {
                let converted = try Currencies.convertAmount(abs(value), from: from, rate: rate, home: to)
                return value < 0 ? -converted : converted
            } catch {
                throw .conversion(error)
            }
        }
        var converted: [SharedBalance] = []
        for item in balances {
            converted.append(SharedBalance(userId: item.userId, balanceCents: try convert(item.balanceCents)))
        }
        var transfers: [SharedTransfer] = []
        for item in suggestions {
            var next = item
            next.amountCents = try convert(item.amountCents)
            transfers.append(next)
        }
        return (converted, transfers)
    }

    /// Why the foreign-amount fields of a shared expense are invalid, or nil when they're fine: the
    /// personal entry rules (`Currencies.foreignAmountProblem`), with the household's currency in
    /// place of the home currency.
    public static func expenseCurrencyProblem(
        totalCents: Int64, originalAmount: Int64?, originalCurrency: String?, rate: String?, rateStatus: RateStatus?,
        rateDate: CalendarDate?, householdCurrency: String
    ) -> String? {
        let entry = LedgerEntry(
            id: "shared", title: "Shared", kind: .expense, total: totalCents, share: totalCents, categoryId: "shared",
            date: rateDate ?? .earliest, originalAmount: originalAmount, originalCurrency: originalCurrency,
            rate: rate, rateStatus: rateStatus, rateDate: rateDate)
        return Currencies.foreignAmountProblem(entry, home: householdCurrency)
    }
}
