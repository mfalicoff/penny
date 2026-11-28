public import PennyDomain

// Shared expenses in several currencies on the viewer's screens (MAZ-151 phase 2, contract
// 2.6.0): what was paid, and the same expense in the viewer's home currency.

/// One shared expense as the viewer reads it: the amount paid in the currency it was paid in, and
/// its total and the viewer's share in their home currency, when those are known.
public struct SharedExpenseAmounts: Equatable, Sendable {
    /// What was paid: the original amount, or the total when it was paid in the household's currency.
    public let paid: Int64
    public let paidCurrency: String
    /// The viewer's home (ledger) currency.
    public let home: String
    /// The total and the viewer's share in `home`; nil when the household is in another currency
    /// and the server sent no home amounts (no rate known, or an older server).
    public let homeTotal: Int64?
    public let homeShare: Int64?
    /// The home amounts follow a provisional rate.
    public let provisional: Bool

    /// Paid in another currency than the viewer's: the home amount goes under the amount paid.
    public var showsHome: Bool { paidCurrency != home && homeTotal != nil }
}

extension WireSharedExpense {
    /// The expense's foreign-amount status, when it has one.
    public var paidRateStatus: RateStatus? { rateStatus.flatMap(RateStatus.init(rawValue:)) }

    /// What was paid and the viewer's home amounts (`MemberHomeAmounts`), from a household in
    /// `householdCurrency`. In the home currency the household's own amounts are the home ones.
    public func amounts(householdCurrency: String, home: String, meId: String?) -> SharedExpenseAmounts {
        let foreign = originalAmount != nil && originalCurrency.map(Currencies.isCurrency) == true
        let paidCurrency = foreign ? originalCurrency ?? householdCurrency : householdCurrency
        let paid = foreign ? originalAmount ?? totalCents : totalCents
        if householdCurrency == home {
            return SharedExpenseAmounts(
                paid: paid, paidCurrency: paidCurrency, home: home, homeTotal: totalCents, homeShare: share(of: meId),
                provisional: foreign && paidRateStatus == .provisional)
        }
        guard let converted = self.home, converted.currency == home else {
            return SharedExpenseAmounts(
                paid: paid, paidCurrency: paidCurrency, home: home, homeTotal: nil, homeShare: nil, provisional: false)
        }
        return SharedExpenseAmounts(
            paid: paid, paidCurrency: paidCurrency, home: home, homeTotal: converted.totalCents,
            homeShare: converted.shareCents, provisional: converted.rateStatus == RateStatus.provisional.rawValue)
    }
}

/// The currencies a shared trip's expenses were paid in, for its chip ("EUR, USD and CAD · each at
/// its date's rate"): the trip's own first, then the others by code, the viewer's last.
public enum SharedTripCurrencies {
    public static func list(_ expenses: [WireSharedExpense], householdCurrency: String, home: String) -> [String] {
        let paid = Set(expenses.map { $0.originalCurrency ?? householdCurrency })
        let others = paid.subtracting([householdCurrency, home]).sorted()
        return (paid.contains(householdCurrency) ? [householdCurrency] : []) + others
            + (paid.contains(home) && home != householdCurrency ? [home] : [])
    }
}

/// Balances and suggested payments shown in a currency chosen with Settle in (MAZ-151 phase 2,
/// `iphone-trip-balances-currency`): display only. Each suggestion keeps the household-currency
/// transfer that Record paid records.
public struct SettleView: Equatable, Sendable {
    public struct Payment: Equatable, Hashable, Sendable {
        /// What Record paid records, in the household's currency.
        public let transfer: WireTransfer
        /// The amount shown, in `SettleView.currency`.
        public let shownCents: Int64
    }

    /// The currency the figures are shown in.
    public let currency: String
    /// Each balance, in `currency`, keyed by member id.
    public let balances: [String: Int64]
    public let payments: [Payment]

    /// The household's own figures.
    public init(recap: WireMonthRecap, currency: String) {
        self.currency = currency
        balances = Dictionary(recap.balances.map { ($0.userId, $0.balanceCents) }, uniquingKeysWith: { a, _ in a })
        payments = recap.suggestions.map { Payment(transfer: $0, shownCents: $0.amountCents) }
    }

    /// The figures in `to` at `rate` (`to` units per unit of the household's `from`, today's), with
    /// `SharedCurrency.settleIn`. Nil when the balances don't add up or a figure can't convert.
    public init?(recap: WireMonthRecap, from: String, to: String, rate: String) {
        let balances = recap.balances.map { SharedBalance(userId: $0.userId, balanceCents: $0.balanceCents) }
        guard let converted = try? SharedCurrency.settleIn(balances, from: from, to: to, rate: rate) else { return nil }
        currency = to
        self.balances = Dictionary(
            converted.balances.map { ($0.userId, $0.balanceCents) }, uniquingKeysWith: { a, _ in a })
        var shown: [String: Int64] = [:]
        for item in converted.suggestions { shown["\(item.fromUserId)>\(item.toUserId)"] = item.amountCents }
        var payments: [Payment] = []
        for transfer in recap.suggestions {
            let key = "\(transfer.fromUserId)>\(transfer.toUserId)"
            guard
                let cents = shown[key]
                    ?? (try? Currencies.convertAmount(transfer.amountCents, from: from, rate: rate, home: to))
            else { return nil }
            payments.append(Payment(transfer: transfer, shownCents: cents))
        }
        self.payments = payments
    }

    /// The currencies Settle in offers: the household's, then its current members' home
    /// currencies (contract 2.6.0 `HouseholdMember.currency`) by code, each once.
    public static func options(householdCurrency: String, members: [WireHouseholdMember]) -> [String] {
        let others = Set(members.filter(\.isCurrent).compactMap(\.currency).filter(Currencies.isCurrency))
            .subtracting([householdCurrency]).sorted()
        return [householdCurrency] + others
    }

    /// Whether a household shows its currencies at all: it isn't in the viewer's currency, a
    /// member keeps another one, or an expense was paid in another one.
    public static func isMultiCurrency(
        householdCurrency: String, home: String, members: [WireHouseholdMember], expenses: [WireSharedExpense]
    ) -> Bool {
        householdCurrency != home || members.contains { ($0.currency ?? householdCurrency) != householdCurrency }
            || expenses.contains { $0.originalCurrency != nil }
    }
}
