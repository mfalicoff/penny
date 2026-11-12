public import Foundation
public import PennyDomain

/// Everything the household screens ask the server (MAZ-75). A protocol so view models are
/// tested without a network and previews show fixture data; the app uses `APIHouseholdService`.
public protocol HouseholdService: Sendable {
    func households() async throws -> [WireHousehold]
    func household(id: String) async throws -> WireHouseholdDetail
    func createHousehold(name: String, currency: Currency, timezoneOffsetMinutes: Int) async throws -> WireHousehold
    func joinHousehold(code: InviteCode, timezoneOffsetMinutes: Int) async throws -> WireHousehold
    func renameHousehold(id: String, name: String) async throws -> WireHousehold
    func createInvite(householdId: String) async throws -> WireInvite
    func leaveHousehold(id: String) async throws
    func removeMember(householdId: String, userId: String) async throws
    func archiveHousehold(id: String) async throws

    func sharedExpenses(householdId: String, month: MonthKey?) async throws -> [WireSharedExpense]
    func sharedExpense(householdId: String, id: String) async throws -> WireSharedExpense
    func createSharedExpense(householdId: String, _ input: WireExpenseInput) async throws -> WireSharedExpense
    func updateSharedExpense(householdId: String, id: String, _ input: WireExpenseInput) async throws
        -> WireSharedExpense
    func deleteSharedExpense(householdId: String, id: String, revision: Int) async throws
    func recordSharePayment(householdId: String, expenseId: String, fromUserId: String, revision: Int) async throws
        -> WireSharedExpense

    func monthRecap(householdId: String, month: MonthKey) async throws -> WireMonthRecap
    func recordMonthlyPayment(householdId: String, month: MonthKey, transfer: WireTransfer) async throws
        -> WireReimbursement
    func householdAudit(householdId: String, expenseId: String?) async throws -> [WireAuditEvent]

    func sharedRules(householdId: String) async throws -> [WireSharedRule]
    func createSharedRule(householdId: String, _ input: WireRuleInput) async throws -> WireSharedRule
    func updateSharedRule(householdId: String, id: String, _ input: WireRuleInput) async throws -> WireSharedRule
    func deleteSharedRule(householdId: String, id: String, revision: Int) async throws
}

/// The signed-in account's households, straight from the API.
public struct APIHouseholdService: HouseholdService {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func households() async throws -> [WireHousehold] { try await client.households() }
    public func household(id: String) async throws -> WireHouseholdDetail { try await client.household(id: id) }
    public func createHousehold(name: String, currency: Currency, timezoneOffsetMinutes: Int) async throws
        -> WireHousehold
    {
        try await client.createHousehold(name: name, currency: currency, timezoneOffsetMinutes: timezoneOffsetMinutes)
    }
    public func joinHousehold(code: InviteCode, timezoneOffsetMinutes: Int) async throws -> WireHousehold {
        try await client.joinHousehold(code: code, timezoneOffsetMinutes: timezoneOffsetMinutes)
    }
    public func renameHousehold(id: String, name: String) async throws -> WireHousehold {
        try await client.renameHousehold(id: id, name: name)
    }
    public func createInvite(householdId: String) async throws -> WireInvite {
        try await client.createInvite(householdId: householdId)
    }
    public func leaveHousehold(id: String) async throws { try await client.leaveHousehold(id: id) }
    public func removeMember(householdId: String, userId: String) async throws {
        try await client.removeMember(householdId: householdId, userId: userId)
    }
    public func archiveHousehold(id: String) async throws { try await client.archiveHousehold(id: id) }

    public func sharedExpenses(householdId: String, month: MonthKey?) async throws -> [WireSharedExpense] {
        try await client.sharedExpenses(householdId: householdId, month: month)
    }
    public func sharedExpense(householdId: String, id: String) async throws -> WireSharedExpense {
        try await client.sharedExpense(householdId: householdId, id: id)
    }
    public func createSharedExpense(householdId: String, _ input: WireExpenseInput) async throws -> WireSharedExpense {
        try await client.createSharedExpense(householdId: householdId, input)
    }
    public func updateSharedExpense(householdId: String, id: String, _ input: WireExpenseInput) async throws
        -> WireSharedExpense
    {
        try await client.updateSharedExpense(householdId: householdId, id: id, input)
    }
    public func deleteSharedExpense(householdId: String, id: String, revision: Int) async throws {
        try await client.deleteSharedExpense(householdId: householdId, id: id, revision: revision)
    }
    public func recordSharePayment(householdId: String, expenseId: String, fromUserId: String, revision: Int)
        async throws -> WireSharedExpense
    {
        try await client.recordSharePayment(
            householdId: householdId, expenseId: expenseId, fromUserId: fromUserId, revision: revision)
    }

    public func monthRecap(householdId: String, month: MonthKey) async throws -> WireMonthRecap {
        try await client.monthRecap(householdId: householdId, month: month)
    }
    public func recordMonthlyPayment(householdId: String, month: MonthKey, transfer: WireTransfer) async throws
        -> WireReimbursement
    {
        try await client.recordMonthlyPayment(householdId: householdId, month: month, transfer: transfer)
    }
    public func householdAudit(householdId: String, expenseId: String?) async throws -> [WireAuditEvent] {
        try await client.householdAudit(householdId: householdId, expenseId: expenseId)
    }

    public func sharedRules(householdId: String) async throws -> [WireSharedRule] {
        try await client.sharedRules(householdId: householdId)
    }
    public func createSharedRule(householdId: String, _ input: WireRuleInput) async throws -> WireSharedRule {
        try await client.createSharedRule(householdId: householdId, input)
    }
    public func updateSharedRule(householdId: String, id: String, _ input: WireRuleInput) async throws
        -> WireSharedRule
    {
        try await client.updateSharedRule(householdId: householdId, id: id, input)
    }
    public func deleteSharedRule(householdId: String, id: String, revision: Int) async throws {
        try await client.deleteSharedRule(householdId: householdId, id: id, revision: revision)
    }
}

/// The person's local offset for `timezoneOffsetMinutes` on create, join and expenses.
public enum LocalTimeZone {
    public static func offsetMinutes(_ zone: TimeZone = .current, at date: Date = Date()) -> Int {
        SettlementCalendar.timezoneOffsetMinutes(secondsFromGMT: zone.secondsFromGMT(for: date))
    }
}
