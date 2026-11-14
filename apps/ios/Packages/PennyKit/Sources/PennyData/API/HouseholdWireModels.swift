// Wire models for households, shared expenses, settlement, audit and shared rules
// (contracts/openapi.json; server: MAZ-56–59,
// docs/reference/households.md, shared-expenses.md, settlement.md, shared-recurrence.md).
//
// Same rules as WireModels.swift: integer cents (`Int64`), `YYYY-MM-DD` strings, opaque ids,
// instants as Unix milliseconds (`Int64`), absent optionals nil and omitted when encoding.
// `accountId` is the payer's private account: the server sends it only to the payer.

import Foundation

public struct WireHouseholdTrip: Codable, Equatable, Sendable {
    public var startDate: String
    public var endDate: String

    public init(startDate: String, endDate: String) {
        self.startDate = startDate
        self.endDate = endDate
    }
}

/// `{id, name, currency, creatorId, createdAt, memberCount, trip?}`.
public struct WireHousehold: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var currency: String
    public var creatorId: String
    public var createdAt: Int64
    /// Current members only.
    public var memberCount: Int
    /// Present only for shared trips (MAZ-76 owns their screens).
    public var trip: WireHouseholdTrip?

    public init(
        id: String, name: String, currency: String, creatorId: String, createdAt: Int64, memberCount: Int,
        trip: WireHouseholdTrip? = nil
    ) {
        self.id = id
        self.name = name
        self.currency = currency
        self.creatorId = creatorId
        self.createdAt = createdAt
        self.memberCount = memberCount
        self.trip = trip
    }
}

/// One account's latest membership period. `leftAt` is absent (or `null`) for a current member.
public struct WireHouseholdMember: Codable, Equatable, Sendable, Identifiable {
    public var userId: String
    public var email: String
    public var joinedAt: Int64
    /// The member's local calendar day when they joined; absent when the join request carried
    /// no time zone offset.
    public var joinedOn: String?
    public var leftAt: Int64?

    public var id: String { userId }
    public var isCurrent: Bool { leftAt == nil }

    public init(userId: String, email: String, joinedAt: Int64, joinedOn: String? = nil, leftAt: Int64? = nil) {
        self.userId = userId
        self.email = email
        self.joinedAt = joinedAt
        self.joinedOn = joinedOn
        self.leftAt = leftAt
    }
}

public struct WireHouseholdDetail: Codable, Equatable, Sendable {
    public var household: WireHousehold
    public var members: [WireHouseholdMember]

    public init(household: WireHousehold, members: [WireHouseholdMember]) {
        self.household = household
        self.members = members
    }
}

/// `POST /api/households/{id}/invites`: a 10-character upper-case hex code and its expiry.
public struct WireInvite: Codable, Equatable, Sendable {
    public var code: String
    public var expiresAt: Int64

    public init(code: String, expiresAt: Int64) {
        self.code = code
        self.expiresAt = expiresAt
    }
}

/// A shared category travels by value (`{name, icon, color}`); households have no category list.
public struct WireSharedCategory: Codable, Equatable, Hashable, Sendable {
    public var name: String
    public var icon: String
    public var color: String

    public init(name: String, icon: String, color: String) {
        self.name = name
        self.icon = icon
        self.color = color
    }
}

/// An exact (`amountCents`) or percentage (`percentBasisPoints`) allocation. Exactly one is set.
public struct WireAllocation: Codable, Equatable, Sendable {
    public var userId: String
    public var amountCents: Int64?
    public var percentBasisPoints: Int64?

    public static func amount(_ userId: String, _ cents: Int64) -> WireAllocation {
        WireAllocation(userId: userId, amountCents: cents, percentBasisPoints: nil)
    }

    public static func percent(_ userId: String, _ points: Int64) -> WireAllocation {
        WireAllocation(userId: userId, amountCents: nil, percentBasisPoints: points)
    }
}

/// A recorded share: `{userId, amountCents}`.
public struct WireSplit: Codable, Equatable, Sendable {
    public var userId: String
    public var amountCents: Int64

    public init(userId: String, amountCents: Int64) {
        self.userId = userId
        self.amountCents = amountCents
    }
}

/// An individual share payment: the debtor settled their whole share of one expense.
public struct WireExpensePayment: Codable, Equatable, Sendable {
    public var fromUserId: String
    public var amountCents: Int64
    public var createdAt: Int64
    public var createdBy: String

    public init(fromUserId: String, amountCents: Int64, createdAt: Int64, createdBy: String) {
        self.fromUserId = fromUserId
        self.amountCents = amountCents
        self.createdAt = createdAt
        self.createdBy = createdBy
    }
}

/// A shared expense as the server shows it to the caller.
public struct WireSharedExpense: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var householdId: String
    public var title: String
    public var totalCents: Int64
    public var date: String
    public var payerUserId: String
    /// `equal`, `exact` or `percent`.
    public var splitMode: String
    /// Ordered by member id.
    public var splits: [WireSplit]
    public var payments: [WireExpensePayment]
    /// True once the expense's month has a monthly reimbursement: no more individual payments.
    public var paymentsClosed: Bool
    public var category: WireSharedCategory
    public var note: String
    /// The payer's private account. Only the payer ever receives it.
    public var accountId: String?
    public var receiptId: String?
    public var receipt: WireReceipt?
    public var revision: Int
    public var createdBy: String
    public var createdAt: Int64
    public var updatedBy: String
    public var updatedAt: Int64
    /// The shared rule that recorded it, when one did.
    public var recurringId: String?

    public init(
        id: String, householdId: String, title: String, totalCents: Int64, date: String, payerUserId: String,
        splitMode: String, splits: [WireSplit], payments: [WireExpensePayment] = [], paymentsClosed: Bool = false,
        category: WireSharedCategory, note: String = "", accountId: String? = nil, receiptId: String? = nil,
        receipt: WireReceipt? = nil, revision: Int = 0, createdBy: String, createdAt: Int64, updatedBy: String,
        updatedAt: Int64, recurringId: String? = nil
    ) {
        self.id = id
        self.householdId = householdId
        self.title = title
        self.totalCents = totalCents
        self.date = date
        self.payerUserId = payerUserId
        self.splitMode = splitMode
        self.splits = splits
        self.payments = payments
        self.paymentsClosed = paymentsClosed
        self.category = category
        self.note = note
        self.accountId = accountId
        self.receiptId = receiptId
        self.receipt = receipt
        self.revision = revision
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedBy = updatedBy
        self.updatedAt = updatedAt
        self.recurringId = recurringId
    }
}

/// The body of an expense create (`expenseInput`) or update (plus `revision`). Optional
/// fields are omitted, never `null`.
public struct WireExpenseInput: Codable, Equatable, Sendable {
    public var title: String
    public var totalCents: Int64
    public var date: String
    public var payerUserId: String
    public var splitMode: String
    public var allocations: [WireAllocation]?
    public var category: WireSharedCategory
    public var note: String
    public var accountId: String?
    public var receiptId: String?
    public var timezoneOffsetMinutes: Int?
    /// Updates only: the revision the edit is based on.
    public var revision: Int?

    public init(
        title: String, totalCents: Int64, date: String, payerUserId: String, splitMode: String,
        allocations: [WireAllocation]? = nil, category: WireSharedCategory, note: String = "",
        accountId: String? = nil, receiptId: String? = nil, timezoneOffsetMinutes: Int? = nil, revision: Int? = nil
    ) {
        self.title = title
        self.totalCents = totalCents
        self.date = date
        self.payerUserId = payerUserId
        self.splitMode = splitMode
        self.allocations = allocations
        self.category = category
        self.note = note
        self.accountId = accountId
        self.receiptId = receiptId
        self.timezoneOffsetMinutes = timezoneOffsetMinutes
        self.revision = revision
    }
}

/// A reimbursement: a monthly payment (`expenseId` absent) or an individual share payment.
public struct WireReimbursement: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var householdId: String
    public var month: String
    public var fromUserId: String
    public var toUserId: String
    public var amountCents: Int64
    public var createdBy: String
    public var createdAt: Int64
    public var expenseId: String?

    public init(
        id: String, householdId: String, month: String, fromUserId: String, toUserId: String, amountCents: Int64,
        createdBy: String, createdAt: Int64, expenseId: String? = nil
    ) {
        self.id = id
        self.householdId = householdId
        self.month = month
        self.fromUserId = fromUserId
        self.toUserId = toUserId
        self.amountCents = amountCents
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.expenseId = expenseId
    }
}

public struct WireBalance: Codable, Equatable, Sendable {
    public var userId: String
    /// Positive: gets money back. Negative: owes.
    public var balanceCents: Int64

    public init(userId: String, balanceCents: Int64) {
        self.userId = userId
        self.balanceCents = balanceCents
    }
}

/// A suggested full transfer, and the body of a monthly reimbursement.
public struct WireTransfer: Codable, Equatable, Hashable, Sendable {
    public var fromUserId: String
    public var toUserId: String
    public var amountCents: Int64

    public init(fromUserId: String, toUserId: String, amountCents: Int64) {
        self.fromUserId = fromUserId
        self.toUserId = toUserId
        self.amountCents = amountCents
    }
}

/// `GET /api/households/{id}/months/{month}` (no envelope).
public struct WireMonthRecap: Codable, Equatable, Sendable {
    public var month: String
    public var expenses: [WireSharedExpense]
    public var reimbursements: [WireReimbursement]
    public var balances: [WireBalance]
    public var suggestions: [WireTransfer]
    /// Earlier than the current UTC month and still has a suggestion.
    public var overdue: Bool
    public var overdueMonths: [String]

    public init(
        month: String, expenses: [WireSharedExpense] = [], reimbursements: [WireReimbursement] = [],
        balances: [WireBalance] = [], suggestions: [WireTransfer] = [], overdue: Bool = false,
        overdueMonths: [String] = []
    ) {
        self.month = month
        self.expenses = expenses
        self.reimbursements = reimbursements
        self.balances = balances
        self.suggestions = suggestions
        self.overdue = overdue
        self.overdueMonths = overdueMonths
    }
}

/// Any JSON value, for audit snapshots whose shape depends on the action.
public enum WireJSON: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([WireJSON])
    case object([String: WireJSON])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([WireJSON].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: WireJSON].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    public subscript(key: String) -> WireJSON? {
        if case .object(let members) = self { return members[key] }
        return nil
    }

    public var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    /// Whole numbers only (cents, ids are strings).
    public var int64: Int64? {
        guard case .number(let value) = self, value.rounded() == value, abs(value) < 9_007_199_254_740_992 else {
            return nil
        }
        return Int64(value)
    }

    public var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }
}

/// `{id, householdId, expenseId?, actorId, action, before, after, createdAt}`. Snapshots arrive
/// redacted (no payer account, no receipt name).
public struct WireAuditEvent: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var householdId: String
    public var expenseId: String?
    public var actorId: String
    public var action: String
    public var before: WireJSON?
    public var after: WireJSON?
    public var createdAt: Int64

    public init(
        id: String, householdId: String, expenseId: String? = nil, actorId: String, action: String,
        before: WireJSON? = nil, after: WireJSON? = nil, createdAt: Int64
    ) {
        self.id = id
        self.householdId = householdId
        self.expenseId = expenseId
        self.actorId = actorId
        self.action = action
        self.before = before
        self.after = after
        self.createdAt = createdAt
    }
}

/// A shared recurring rule (MAZ-59).
public struct WireSharedRule: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var householdId: String
    public var title: String
    public var totalCents: Int64
    public var payerUserId: String
    public var splitMode: String
    public var allocations: [WireAllocation]?
    public var category: WireSharedCategory
    public var note: String
    public var accountId: String?
    public var receiptId: String?
    /// `weekly`, `monthly` or `yearly`.
    public var frequency: String
    public var nextDate: String
    public var anchorDay: Int?
    public var active: Bool
    public var revision: Int

    public init(
        id: String, householdId: String, title: String, totalCents: Int64, payerUserId: String, splitMode: String,
        allocations: [WireAllocation]? = nil, category: WireSharedCategory, note: String = "",
        accountId: String? = nil, receiptId: String? = nil, frequency: String, nextDate: String,
        anchorDay: Int? = nil, active: Bool = true, revision: Int = 0
    ) {
        self.id = id
        self.householdId = householdId
        self.title = title
        self.totalCents = totalCents
        self.payerUserId = payerUserId
        self.splitMode = splitMode
        self.allocations = allocations
        self.category = category
        self.note = note
        self.accountId = accountId
        self.receiptId = receiptId
        self.frequency = frequency
        self.nextDate = nextDate
        self.anchorDay = anchorDay
        self.active = active
        self.revision = revision
    }
}

/// The body of a rule create, or an update (plus `active` and `revision`).
public struct WireRuleInput: Codable, Equatable, Sendable {
    public var title: String
    public var totalCents: Int64
    public var payerUserId: String
    public var splitMode: String
    public var allocations: [WireAllocation]?
    public var category: WireSharedCategory
    public var note: String
    public var accountId: String?
    public var receiptId: String?
    public var timezoneOffsetMinutes: Int?
    public var frequency: String
    public var nextDate: String
    public var active: Bool?
    public var revision: Int?

    public init(
        title: String, totalCents: Int64, payerUserId: String, splitMode: String, allocations: [WireAllocation]? = nil,
        category: WireSharedCategory, note: String = "", accountId: String? = nil, receiptId: String? = nil,
        timezoneOffsetMinutes: Int? = nil, frequency: String, nextDate: String, active: Bool? = nil,
        revision: Int? = nil
    ) {
        self.title = title
        self.totalCents = totalCents
        self.payerUserId = payerUserId
        self.splitMode = splitMode
        self.allocations = allocations
        self.category = category
        self.note = note
        self.accountId = accountId
        self.receiptId = receiptId
        self.timezoneOffsetMinutes = timezoneOffsetMinutes
        self.frequency = frequency
        self.nextDate = nextDate
        self.active = active
        self.revision = revision
    }
}
