import Foundation
import PennyData
import PennyDomain
import Synchronization

/// A household server in memory that keeps the server's own rules where the screens depend on
/// them: revisions (a stale one is `409 Expense changed…`), monthly suggestions that must match,
/// invite codes, paid expenses. Fixture ids and `.test` emails only.
final class FakeHouseholds: HouseholdService {
    struct State {
        var households: [WireHousehold] = []
        var members: [String: [WireHouseholdMember]] = [:]
        var recaps: [String: WireMonthRecap] = [:]
        var expenses: [String: WireSharedExpense] = [:]
        var rules: [String: WireSharedRule] = [:]
        var events: [WireAuditEvent] = []
        var archived: Set<String> = []
        var inviteCode = "A1B2C3D4E5"
        /// The next call to the named method throws this, once.
        var failNext: [String: APIError] = [:]
        var calls: [String] = []
        var bodies: [String: WireExpenseInput] = [:]
        var ruleBodies: [WireRuleInput] = []
        var nextId = 0
        /// How long each answer takes, by method name or `monthRecap <YYYY-MM>`.
        var delays: [String: Duration] = [:]
    }

    let state = Mutex(State())

    static let me = "user-alex"
    static let bea = "user-bea"
    static let cam = "user-cam"
    static let email = "alex@example.test"
    static let home = "house-1"
    static let november = MonthKey(year: 2026, month: 11) ?? MonthKey(.earliest)

    static func member(_ id: String, joinedOn: String = "2026-09-01", leftAt: Int64? = nil) -> WireHouseholdMember {
        WireHouseholdMember(
            userId: id, email: "\(id.dropFirst(5))@example.test", joinedAt: 1_788_000_000_000, joinedOn: joinedOn,
            leftAt: leftAt)
    }

    static func expense(
        _ id: String, total: Int64 = 9000, payer: String = me, splits: [(String, Int64)]? = nil, revision: Int = 0,
        date: String = "2026-11-04", payments: [WireExpensePayment] = []
    ) -> WireSharedExpense {
        let shares = splits ?? [(me, total / 3), (bea, total / 3), (cam, total - 2 * (total / 3))]
        return WireSharedExpense(
            id: id, householdId: home, title: "Hydro", totalCents: total, date: date, payerUserId: payer,
            splitMode: "equal", splits: shares.map { WireSplit(userId: $0.0, amountCents: $0.1) }, payments: payments,
            category: WireSharedCategory(name: "Home", icon: "home-outline", color: "#3B82F6"), revision: revision,
            createdBy: payer, createdAt: 1_793_000_000_000, updatedBy: payer, updatedAt: 1_793_000_000_000)
    }

    /// A household of three (Alex created it) with one expense Alex paid this November.
    static func standard() -> FakeHouseholds {
        let fake = FakeHouseholds()
        fake.state.withLock { state in
            state.households = [
                WireHousehold(
                    id: home, name: "Apartment", currency: "CAD", creatorId: me, createdAt: 1_788_000_000_000,
                    memberCount: 3)
            ]
            state.members[home] = [member(me), member(bea), member(cam, joinedOn: "2026-10-14")]
            let hydro = expense("hydro")
            state.expenses["hydro"] = hydro
            state.recaps["\(home) 2026-11"] = WireMonthRecap(
                month: "2026-11", expenses: [hydro],
                balances: [
                    WireBalance(userId: me, balanceCents: 6000), WireBalance(userId: bea, balanceCents: -3000),
                    WireBalance(userId: cam, balanceCents: -3000),
                ],
                suggestions: [
                    WireTransfer(fromUserId: bea, toUserId: me, amountCents: 3000),
                    WireTransfer(fromUserId: cam, toUserId: me, amountCents: 3000),
                ])
        }
        return fake
    }

    var calls: [String] { state.withLock { $0.calls } }

    func fail(_ method: String, with error: APIError) { state.withLock { $0.failNext[method] = error } }

    private func call(_ name: String, key: String? = nil) async throws {
        let delay = try state.withLock { state -> Duration? in
            state.calls.append(name)
            if let error = state.failNext.removeValue(forKey: name) { throw error }
            return state.delays[key ?? name]
        }
        if let delay { try await Task.sleep(for: delay) }
    }

    func delay(_ key: String, _ duration: Duration) { state.withLock { $0.delays[key] = duration } }

    private func recap(_ household: String, _ month: MonthKey) -> WireMonthRecap {
        state.withLock { $0.recaps["\(household) \(month)"] } ?? WireMonthRecap(month: "\(month)")
    }

    func households() async throws -> [WireHousehold] {
        try await call("households")
        return state.withLock { state in state.households.filter { !state.archived.contains($0.id) } }
    }

    func household(id: String) async throws -> WireHouseholdDetail {
        try await call("household")
        return try state.withLock { state in
            guard let household = state.households.first(where: { $0.id == id }) else {
                throw APIError.notFound(message: "Household not found.")
            }
            return WireHouseholdDetail(household: household, members: state.members[id] ?? [])
        }
    }

    func createHousehold(name: String, currency: Currency, timezoneOffsetMinutes: Int) async throws -> WireHousehold {
        try await call("createHousehold")
        return state.withLock { state in
            state.nextId += 1
            let household = WireHousehold(
                id: "house-new-\(state.nextId)", name: name, currency: currency.rawValue, creatorId: Self.me,
                createdAt: 1_793_000_000_000, memberCount: 1)
            state.households.insert(household, at: 0)
            state.members[household.id] = [Self.member(Self.me)]
            return household
        }
    }

    func joinHousehold(code: InviteCode, timezoneOffsetMinutes: Int) async throws -> WireHousehold {
        try await call("joinHousehold")
        return try state.withLock { state in
            guard code.value == state.inviteCode, let household = state.households.first else {
                throw APIError.badRequest(message: "Invite code is invalid or expired.")
            }
            return household
        }
    }

    func renameHousehold(id: String, name: String) async throws -> WireHousehold {
        try await call("renameHousehold")
        return try state.withLock { state in
            guard let index = state.households.firstIndex(where: { $0.id == id }) else {
                throw APIError.notFound(message: "Household not found.")
            }
            state.households[index].name = name
            return state.households[index]
        }
    }

    func createInvite(householdId: String) async throws -> WireInvite {
        try await call("createInvite")
        return WireInvite(code: state.withLock { $0.inviteCode }, expiresAt: 1_793_000_600_000)
    }

    func leaveHousehold(id: String) async throws {
        try await call("leaveHousehold")
        state.withLock { state in
            state.members[id] = state.members[id]?.map { member in
                var left = member
                if member.userId == Self.me { left.leftAt = 1_793_000_000_000 }
                return left
            }
        }
    }

    func removeMember(householdId: String, userId: String) async throws {
        try await call("removeMember")
        state.withLock { state in
            state.members[householdId] = state.members[householdId]?.map { member in
                var left = member
                if member.userId == userId { left.leftAt = 1_793_000_000_000 }
                return left
            }
        }
    }

    func archiveHousehold(id: String) async throws {
        try await call("archiveHousehold")
        _ = state.withLock { $0.archived.insert(id) }
    }

    func sharedExpenses(householdId: String, month: MonthKey?) async throws -> [WireSharedExpense] {
        try await call("sharedExpenses")
        return state.withLock { Array($0.expenses.values) }
    }

    func sharedExpense(householdId: String, id: String) async throws -> WireSharedExpense {
        try await call("sharedExpense")
        return try state.withLock { state in
            guard let expense = state.expenses[id] else { throw APIError.notFound(message: "Expense not found.") }
            return expense
        }
    }

    func createSharedExpense(householdId: String, _ input: WireExpenseInput) async throws -> WireSharedExpense {
        try await call("createSharedExpense")
        return state.withLock { state in
            state.nextId += 1
            let id = "expense-\(state.nextId)"
            state.bodies[id] = input
            let expense = WireSharedExpense(
                id: id, householdId: householdId, title: input.title, totalCents: input.totalCents, date: input.date,
                payerUserId: input.payerUserId, splitMode: input.splitMode, splits: [], category: input.category,
                note: input.note, accountId: input.accountId, createdBy: Self.me, createdAt: 0, updatedBy: Self.me,
                updatedAt: 0)
            state.expenses[id] = expense
            return expense
        }
    }

    func updateSharedExpense(householdId: String, id: String, _ input: WireExpenseInput) async throws
        -> WireSharedExpense
    {
        try await call("updateSharedExpense")
        return try state.withLock { state in
            guard var expense = state.expenses[id] else { throw APIError.notFound(message: "Expense not found.") }
            guard input.revision == expense.revision else {
                throw APIError.conflict(message: "Expense changed. Refresh and try again.")
            }
            state.bodies[id] = input
            expense.title = input.title
            expense.totalCents = input.totalCents
            expense.revision += 1
            state.expenses[id] = expense
            return expense
        }
    }

    func deleteSharedExpense(householdId: String, id: String, revision: Int) async throws {
        try await call("deleteSharedExpense")
        try state.withLock { state in
            guard let expense = state.expenses[id] else { throw APIError.notFound(message: "Expense not found.") }
            guard expense.revision == revision else {
                throw APIError.conflict(message: "Expense changed. Refresh and try again.")
            }
            guard expense.payments.isEmpty else { throw APIError.conflict(message: "Paid expenses cannot be deleted.") }
            state.expenses[id] = nil
        }
    }

    func recordSharePayment(householdId: String, expenseId: String, fromUserId: String, revision: Int) async throws
        -> WireSharedExpense
    {
        try await call("recordSharePayment")
        return try state.withLock { state in
            guard var expense = state.expenses[expenseId] else {
                throw APIError.notFound(message: "Expense not found.")
            }
            guard expense.revision == revision else {
                throw APIError.conflict(message: "Expense changed. Refresh and try again.")
            }
            guard !expense.payments.contains(where: { $0.fromUserId == fromUserId }) else {
                throw APIError.conflict(message: "This share is already paid.")
            }
            expense.payments.append(
                WireExpensePayment(
                    fromUserId: fromUserId, amountCents: expense.share(of: fromUserId), createdAt: 0, createdBy: Self.me
                ))
            expense.revision += 1
            state.expenses[expenseId] = expense
            return expense
        }
    }

    func monthRecap(householdId: String, month: MonthKey) async throws -> WireMonthRecap {
        try await call("monthRecap", key: "monthRecap \(month)")
        var recap = recap(householdId, month)
        let stored = state.withLock { $0.expenses }
        recap.expenses = recap.expenses.map { stored[$0.id] ?? $0 }
        return recap
    }

    func recordMonthlyPayment(householdId: String, month: MonthKey, transfer: WireTransfer) async throws
        -> WireReimbursement
    {
        try await call("recordMonthlyPayment")
        return try state.withLock { state in
            let key = "\(householdId) \(month)"
            guard var recap = state.recaps[key], let index = recap.suggestions.firstIndex(of: transfer) else {
                throw APIError.conflict(message: "This is no longer the full suggested reimbursement.")
            }
            recap.suggestions.remove(at: index)
            state.recaps[key] = recap
            return WireReimbursement(
                id: "r1", householdId: householdId, month: "\(month)", fromUserId: transfer.fromUserId,
                toUserId: transfer.toUserId, amountCents: transfer.amountCents, createdBy: Self.me, createdAt: 0)
        }
    }

    func householdAudit(householdId: String, expenseId: String?) async throws -> [WireAuditEvent] {
        try await call("householdAudit")
        return state.withLock { state in state.events.filter { expenseId == nil || $0.expenseId == expenseId } }
    }

    func sharedRules(householdId: String) async throws -> [WireSharedRule] {
        try await call("sharedRules")
        return state.withLock { Array($0.rules.values) }
    }

    func createSharedRule(householdId: String, _ input: WireRuleInput) async throws -> WireSharedRule {
        try await call("createSharedRule")
        return state.withLock { state in
            state.ruleBodies.append(input)
            let rule = WireSharedRule(
                id: "rule-1", householdId: householdId, title: input.title, totalCents: input.totalCents,
                payerUserId: input.payerUserId, splitMode: input.splitMode, allocations: input.allocations,
                category: input.category, frequency: input.frequency, nextDate: input.nextDate)
            state.rules[rule.id] = rule
            return rule
        }
    }

    func updateSharedRule(householdId: String, id: String, _ input: WireRuleInput) async throws -> WireSharedRule {
        try await call("updateSharedRule")
        return try state.withLock { state in
            guard var rule = state.rules[id] else { throw APIError.notFound(message: "Recurring rule not found.") }
            guard input.revision == rule.revision else {
                throw APIError.conflict(message: "Recurring rule changed. Refresh and try again.")
            }
            state.ruleBodies.append(input)
            rule.active = input.active ?? rule.active
            rule.revision += 1
            state.rules[id] = rule
            return rule
        }
    }

    func deleteSharedRule(householdId: String, id: String, revision: Int) async throws {
        try await call("deleteSharedRule")
        state.withLock { $0.rules[id] = nil }
    }
}
