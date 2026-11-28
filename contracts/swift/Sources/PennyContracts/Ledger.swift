/// The wire ledger, version 4 (`accounts`, `trips` and `dismissedSuggestions` may be absent).
public struct Ledger: Codable, Equatable, Sendable {
    public var version: Int
    public var currency: String
    public var categories: [Category]
    public var accounts: [Account]?
    public var trips: [Trip]?
    public var transactions: [Entry]
    public var recurring: [Recurring]
    /// Contract 2.3.0: dismissed recurring suggestions, `{kind}|{key}|{frequency}|{share}`. Optional.
    public var dismissedSuggestions: [String]?

    public struct Category: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var icon: String
        public var color: String
        public var kind: String
    }

    public struct Account: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var type: String
    }

    public struct Trip: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var startDate: String
        public var endDate: String
        public var sharedHouseholdId: String?
        /// Contract 2.6.0 (MAZ-151 phase 2): a personal trip's currency.
        public var currency: String?
    }

    /// Money is integer cents.
    public struct Entry: Codable, Equatable, Sendable {
        public var id: String
        public var title: String
        public var kind: String
        public var total: Int64
        public var share: Int64
        public var categoryId: String
        public var accountId: String?
        public var tripId: String?
        public var recurringId: String?
        public var date: String
        public var note: String
        /// Contract 2.4.0 (MAZ-151): the amount paid in another currency, in its minor units,
        /// with the rate that converted it to `total`. All four or none.
        public var originalAmount: Int64?
        public var originalCurrency: String?
        public var rate: String?
        public var rateStatus: String?
        /// Absent for an edited rate.
        public var rateDate: String?
    }

    public struct Recurring: Codable, Equatable, Sendable {
        public var id: String
        public var title: String
        public var kind: String
        public var total: Int64
        public var share: Int64
        public var categoryId: String
        public var accountId: String?
        public var date: String
        public var note: String
        public var frequency: String
        public var nextDate: String
        public var anchorDay: Int
        public var active: Bool
        /// Never valid on a rule (contract 2.4.0); declared so currency.json's invalid ledger decodes.
        public var originalAmount: Int64?
        public var originalCurrency: String?
        public var rate: String?
        public var rateStatus: String?
        public var rateDate: String?
    }
}
