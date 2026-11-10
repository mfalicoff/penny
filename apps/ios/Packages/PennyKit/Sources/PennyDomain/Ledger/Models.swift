/// Entry kind. Raw values are the wire strings.
public enum EntryKind: String, CaseIterable, Hashable, Sendable {
    case expense, income, investment
}

public enum RecurrenceFrequency: String, CaseIterable, Hashable, Sendable {
    case weekly, monthly, yearly
}

public enum AccountType: String, CaseIterable, Hashable, Sendable {
    case bank, credit, cash, other
}

/// The ledger currencies every server accepts. Raw values are the ISO 4217 wire codes.
public enum Currency: String, CaseIterable, Hashable, Sendable {
    case cad = "CAD"
    case usd = "USD"
    case eur = "EUR"
    case gbp = "GBP"
}

/// A payment account is a label (which card or account paid), never a balance.
public struct PaymentAccount: Hashable, Sendable {
    public var id: String
    public var name: String
    public var type: AccountType

    public init(id: String, name: String, type: AccountType) {
        self.id = id
        self.name = name
        self.type = type
    }
}

/// A personal trip. Only expenses can belong to one.
public struct Trip: Hashable, Sendable {
    public var id: String
    public var name: String
    public var startDate: CalendarDate
    public var endDate: CalendarDate
    /// Set when the trip is shared with a household. Personal rules never create or change it.
    public var sharedHouseholdId: String?

    public init(
        id: String, name: String, startDate: CalendarDate, endDate: CalendarDate,
        sharedHouseholdId: String? = nil
    ) {
        self.id = id
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
        self.sharedHouseholdId = sharedHouseholdId
    }
}

/// A category. Every entry and rule must use a category of its own kind.
///
/// Named `LedgerCategory` rather than `Category`: Foundation re-exports the Objective-C
/// runtime's `Category` typealias, which would make the short name ambiguous for callers.
public struct LedgerCategory: Hashable, Sendable {
    public var id: String
    public var name: String
    public var icon: String
    /// `#RRGGBB`.
    public var color: String
    public var kind: EntryKind

    public init(id: String, name: String, icon: String, color: String, kind: EntryKind) {
        self.id = id
        self.name = name
        self.icon = icon
        self.color = color
        self.kind = kind
    }
}

public struct ReceiptReference: Hashable, Sendable {
    public var id: String
    public var name: String
    public var uri: String
    public var mime: String

    public init(id: String, name: String, uri: String, mime: String) {
        self.id = id
        self.name = name
        self.uri = uri
        self.mime = mime
    }
}

/// A recorded entry. `total` is the receipt amount and `share` is the part that is yours,
/// both in integer cents (the minor unit of the ledger currency). Reports always use `share`.
///
/// Optional fields are absent when nil, never an empty string or a JSON `null`: clearing one
/// means setting it to nil, and the wire layer then omits the key (docs/migration/ledger.md).
public struct LedgerEntry: Hashable, Sendable {
    public var id: String
    public var title: String
    public var kind: EntryKind
    public var total: Int64
    public var share: Int64
    public var categoryId: String
    public var accountId: String?
    public var tripId: String?
    public var date: CalendarDate
    public var note: String
    public var receipt: ReceiptReference?
    /// The rule this entry was recorded from. It may name a rule that was since removed:
    /// removing a schedule keeps its history.
    public var recurringId: String?

    public init(
        id: String, title: String, kind: EntryKind, total: Int64, share: Int64, categoryId: String,
        accountId: String? = nil, tripId: String? = nil, date: CalendarDate, note: String = "",
        receipt: ReceiptReference? = nil, recurringId: String? = nil
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.total = total
        self.share = share
        self.categoryId = categoryId
        self.accountId = accountId
        self.tripId = tripId
        self.date = date
        self.note = note
        self.receipt = receipt
        self.recurringId = recurringId
    }
}

/// A repeating rule. `date` is the first occurrence, `nextDate` the next one not yet
/// recorded, and `anchorDay` the day of month monthly and yearly occurrences return to after
/// a short month. Rules never carry a trip or a receipt.
public struct RecurringRule: Hashable, Sendable {
    public var id: String
    public var title: String
    public var kind: EntryKind
    public var total: Int64
    public var share: Int64
    public var categoryId: String
    public var accountId: String?
    public var date: CalendarDate
    public var note: String
    public var frequency: RecurrenceFrequency
    public var nextDate: CalendarDate
    /// 1...31.
    public var anchorDay: Int
    public var active: Bool

    public init(
        id: String, title: String, kind: EntryKind, total: Int64, share: Int64, categoryId: String,
        accountId: String? = nil, date: CalendarDate, note: String = "",
        frequency: RecurrenceFrequency, nextDate: CalendarDate, anchorDay: Int, active: Bool = true
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.total = total
        self.share = share
        self.categoryId = categoryId
        self.accountId = accountId
        self.date = date
        self.note = note
        self.frequency = frequency
        self.nextDate = nextDate
        self.anchorDay = anchorDay
        self.active = active
    }
}

/// The personal ledger, wire version 4. It is a value: every rule in PennyDomain takes a
/// ledger and returns a new one, so a refused change leaves nothing half-written and a caller
/// can keep the previous value as its base snapshot for the offline merge (MAZ-71).
public struct Ledger: Hashable, Sendable {
    public static let version = 4
    public static let maxAccounts = 300
    public static let maxTrips = 300
    public static let maxCategories = 300
    public static let maxEntries = 100_000
    public static let maxRules = 1_000
    /// The longest id, in UTF-16 code units (`LedgerLimits.IdLength`, zod `max(100)`).
    public static let maxIDLength = 100

    public var currency: Currency
    public var accounts: [PaymentAccount]
    public var trips: [Trip]
    public var categories: [LedgerCategory]
    public var transactions: [LedgerEntry]
    public var recurring: [RecurringRule]

    public init(
        currency: Currency = .cad, accounts: [PaymentAccount] = [], trips: [Trip] = [],
        categories: [LedgerCategory] = Ledger.defaultCategories, transactions: [LedgerEntry] = [],
        recurring: [RecurringRule] = []
    ) {
        self.currency = currency
        self.accounts = accounts
        self.trips = trips
        self.categories = categories
        self.transactions = transactions
        self.recurring = recurring
    }

    /// The investment category version 1 ledgers gain on upgrade (legacy `investmentCategory`).
    public static let investmentCategory = LedgerCategory(
        id: "investments", name: "Investments", icon: "trending-up-outline", color: "#678DB1", kind: .investment)

    /// The categories a new ledger starts with (legacy `initialCategories`).
    public static let defaultCategories: [LedgerCategory] = [
        LedgerCategory(id: "groceries", name: "Groceries", icon: "basket-outline", color: "#6C9C79", kind: .expense),
        LedgerCategory(id: "food", name: "Food & drinks", icon: "cafe-outline", color: "#E47850", kind: .expense),
        LedgerCategory(id: "home", name: "Home", icon: "home-outline", color: "#C6953A", kind: .expense),
        LedgerCategory(id: "transport", name: "Transport", icon: "bus-outline", color: "#678DB1", kind: .expense),
        LedgerCategory(
            id: "shopping", name: "Shopping", icon: "bag-handle-outline", color: "#C8798D", kind: .expense),
        LedgerCategory(
            id: "fun", name: "Entertainment", icon: "musical-notes-outline", color: "#9D83BA", kind: .expense),
        LedgerCategory(id: "health", name: "Health", icon: "heart-outline", color: "#6C9C79", kind: .expense),
        LedgerCategory(id: "other", name: "Other", icon: "ellipsis-horizontal", color: "#89918C", kind: .expense),
        LedgerCategory(id: "salary", name: "Salary", icon: "briefcase-outline", color: "#6C9C79", kind: .income),
        LedgerCategory(id: "freelance", name: "Freelance", icon: "laptop-outline", color: "#678DB1", kind: .income),
        LedgerCategory(id: "gift", name: "Gifts", icon: "gift-outline", color: "#C6953A", kind: .income),
        investmentCategory,
    ]

    /// The category palette (legacy `palette`).
    public static let palette = ["#E47850", "#C6953A", "#6C9C79", "#678DB1", "#9D83BA", "#C8798D"]

    public func entry(id: String) -> LedgerEntry? { transactions.first { $0.id == id } }
    public func rule(id: String) -> RecurringRule? { recurring.first { $0.id == id } }
    public func category(id: String) -> LedgerCategory? { categories.first { $0.id == id } }
    public func account(id: String) -> PaymentAccount? { accounts.first { $0.id == id } }
    public func trip(id: String) -> Trip? { trips.first { $0.id == id } }
}
