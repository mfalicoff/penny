/// The wire ledger, version 4 (`accounts` and `trips` may be absent).
public struct Ledger: Codable, Equatable, Sendable {
    public var version: Int
    public var currency: String
    public var categories: [Category]
    public var accounts: [Account]?
    public var trips: [Trip]?
    public var transactions: [Entry]
    public var recurring: [Recurring]

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
    }
}
