import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

// Xcode previews of the shared cards MAZ-75 owns, named after their cards in
// docs/design/penny-ios and the redesign specimen names the issue lists (`shared`, `household`,
// `balances`, `people`, `household-create`, `join-group`, `invite`, `shared-expense`,
// `shared-split`, `shared-payer`, `shared-expense-detail`, `record-share`, `record-monthly`,
// `history`, `archive`, `payment-stale`). Made-up data and `.test` addresses only. Writes
// answer "offline", which also previews the online requirement and kept drafts.

/// A household of three in November 2026, read-only.
struct PreviewHouseholds: HouseholdService {
    static let me = "u-max"
    static let mira = "u-mira"
    static let jo = "u-jo"
    static let home = "apartment"
    static let category = WireSharedCategory(name: "Home", icon: "home-outline", color: "#3B82F6")
    static let groceries = WireSharedCategory(name: "Groceries", icon: "basket-outline", color: "#0FA3A3")

    static let household = WireHousehold(
        id: home, name: "Apartment", currency: "CAD", creatorId: me, createdAt: 1_788_300_000_000, memberCount: 3)

    static let members = [
        WireHouseholdMember(userId: me, email: "max@example.test", joinedAt: 1_788_300_000_000, joinedOn: "2026-09-02"),
        WireHouseholdMember(
            userId: mira, email: "mira@example.test", joinedAt: 1_788_300_000_000, joinedOn: "2026-09-02"),
        WireHouseholdMember(userId: jo, email: "jo@example.test", joinedAt: 1_792_000_000_000, joinedOn: "2026-10-14"),
    ]

    static func expense(
        _ id: String, _ title: String, total: Int64, payer: String, splits: [(String, Int64)],
        category: WireSharedCategory = category, date: String, payments: [WireExpensePayment] = [], revision: Int = 0
    ) -> WireSharedExpense {
        WireSharedExpense(
            id: id, householdId: home, title: title, totalCents: total, date: date, payerUserId: payer,
            splitMode: "equal", splits: splits.map { WireSplit(userId: $0.0, amountCents: $0.1) }, payments: payments,
            category: category, revision: revision, createdBy: payer, createdAt: 1_793_000_000_000, updatedBy: payer,
            updatedAt: 1_793_000_000_000)
    }

    static let hydro = expense(
        "hydro", "Hydro", total: 9630, payer: mira, splits: [(me, 3210), (mira, 3210), (jo, 3210)], date: "2026-11-07")
    static let costco = expense(
        "costco", "Costco run", total: 18420, payer: jo, splits: [(me, 6140), (mira, 6140), (jo, 6140)],
        category: groceries, date: "2026-11-04",
        payments: [WireExpensePayment(fromUserId: me, amountCents: 6140, createdAt: 1_793_100_000_000, createdBy: me)])
    static let rent = expense(
        "rent", "Rent", total: 290_000, payer: me, splits: [(me, 145_000), (mira, 72_500), (jo, 72_500)],
        date: "2026-11-01")

    static let recap = WireMonthRecap(
        month: "2026-11", expenses: [hydro, costco, rent],
        balances: [
            WireBalance(userId: jo, balanceCents: 92_640), WireBalance(userId: me, balanceCents: 142_500),
            WireBalance(userId: mira, balanceCents: -235_140),
        ],
        suggestions: [
            WireTransfer(fromUserId: mira, toUserId: me, amountCents: 142_500),
            WireTransfer(fromUserId: mira, toUserId: jo, amountCents: 92_640),
        ], overdue: false, overdueMonths: ["2026-10"])

    static let rule = WireSharedRule(
        id: "rent-rule", householdId: home, title: "Rent", totalCents: 290_000, payerUserId: me, splitMode: "equal",
        category: category, frequency: "monthly", nextDate: "2026-12-01")

    static let events = [
        WireAuditEvent(
            id: "e1", householdId: home, expenseId: "hydro", actorId: mira, action: "expense.created",
            after: .object(["title": .string("Hydro"), "totalCents": .number(9630), "splitMode": .string("equal")]),
            createdAt: 1_793_350_000_000),
        WireAuditEvent(
            id: "e2", householdId: home, expenseId: "costco", actorId: me, action: "reimbursement.created",
            after: .object([
                "fromUserId": .string(me), "toUserId": .string(jo), "amountCents": .number(6140),
                "expenseId": .string("costco"),
            ]), createdAt: 1_793_100_000_000),
        WireAuditEvent(
            id: "e3", householdId: home, actorId: jo, action: "member.joined", after: .object(["userId": .string(jo)]),
            createdAt: 1_792_000_000_000),
    ]

    func households() async throws -> [WireHousehold] {
        [
            Self.household,
            WireHousehold(
                id: "lisbon", name: "Lisbon", currency: "CAD", creatorId: Self.mira,
                createdAt: 1_790_000_000_000, memberCount: 4,
                trip: WireHouseholdTrip(startDate: "2026-11-12", endDate: "2026-11-19")),
        ]
    }
    func household(id: String) async throws -> WireHouseholdDetail {
        WireHouseholdDetail(household: Self.household, members: Self.members)
    }
    func monthRecap(householdId: String, month: MonthKey) async throws -> WireMonthRecap { Self.recap }
    func sharedExpenses(householdId: String, month: MonthKey?) async throws -> [WireSharedExpense] {
        Self.recap.expenses
    }
    func sharedExpense(householdId: String, id: String) async throws -> WireSharedExpense {
        Self.recap.expenses.first { $0.id == id } ?? Self.hydro
    }
    func householdAudit(householdId: String, expenseId: String?) async throws -> [WireAuditEvent] { Self.events }
    func sharedRules(householdId: String) async throws -> [WireSharedRule] { [Self.rule] }
    func createInvite(householdId: String) async throws -> WireInvite {
        WireInvite(code: "4F2A9C01BE", expiresAt: Int64(Date().addingTimeInterval(582).timeIntervalSince1970 * 1000))
    }

    func createHousehold(name: String, currency: Currency, timezoneOffsetMinutes: Int) async throws -> WireHousehold {
        throw APIError.offline
    }
    func joinHousehold(code: InviteCode, timezoneOffsetMinutes: Int) async throws -> WireHousehold {
        throw APIError.badRequest(message: "Invite code is invalid or expired.")
    }
    func renameHousehold(id: String, name: String) async throws -> WireHousehold { throw APIError.offline }
    func leaveHousehold(id: String) async throws {
        throw APIError.conflict(message: "Settle every monthly balance before leaving.")
    }
    func removeMember(householdId: String, userId: String) async throws { throw APIError.offline }
    func archiveHousehold(id: String) async throws {
        throw APIError.conflict(message: "Settle all monthly balances before archiving.")
    }
    func createSharedExpense(householdId: String, _ input: WireExpenseInput) async throws -> WireSharedExpense {
        throw APIError.offline
    }
    func updateSharedExpense(householdId: String, id: String, _ input: WireExpenseInput) async throws
        -> WireSharedExpense
    {
        throw APIError.conflict(message: "Expense changed. Refresh and try again.")
    }
    func deleteSharedExpense(householdId: String, id: String, revision: Int) async throws { throw APIError.offline }
    func recordSharePayment(householdId: String, expenseId: String, fromUserId: String, revision: Int) async throws
        -> WireSharedExpense
    {
        throw APIError.conflict(message: "Expense changed. Refresh and try again.")
    }
    func recordMonthlyPayment(householdId: String, month: MonthKey, transfer: WireTransfer) async throws
        -> WireReimbursement
    {
        throw APIError.conflict(message: "This is no longer the full suggested reimbursement.")
    }
    func createSharedRule(householdId: String, _ input: WireRuleInput) async throws -> WireSharedRule {
        throw APIError.offline
    }
    func updateSharedRule(householdId: String, id: String, _ input: WireRuleInput) async throws -> WireSharedRule {
        throw APIError.offline
    }
    func deleteSharedRule(householdId: String, id: String, revision: Int) async throws { throw APIError.offline }
}

@MainActor
private enum HouseholdSpecimen {
    static func shell() -> ShellModel {
        ShellModel(
            workspace: FixedWorkspace(load: .ready(Specimen.ledger())), session: .demo, today: Specimen.today,
            households: PreviewHouseholds(), householdEmail: "max@example.test")
    }

    static func model(_ shell: ShellModel) -> HouseholdModel? { shell.households.model(for: PreviewHouseholds.home) }
}

#Preview("iphone-shared-list · shared") {
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { SharedView() } }
}

#Preview("iphone-shared · household") {
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { HouseholdDetailView(id: PreviewHouseholds.home) } }
}

#Preview("iphone-shared-balances · balances, archive") {
    // Balances and People are sections of the household page; Archive confirms from People.
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { HouseholdDetailView(id: PreviewHouseholds.home) } }
}

#Preview("iphone-household-create · household-create") {
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) { HouseholdStartSheet(start: .create) }
}

#Preview("iphone-household-create · join-group (link for another server)") {
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) {
        HouseholdStartSheet(start: .join(code: "4F2A9C01BE", server: "https://friends.example.test"))
            .environment(InviteHandoff(allowsLoopbackHTTP: false))
    }
}

#Preview("iphone-shared-people · people, invite") {
    let shell = HouseholdSpecimen.shell()
    return SpecimenHost(shell: shell) {
        if let model = HouseholdSpecimen.model(shell) { InviteSheet(model: model) }
    }
}

#Preview("iphone-shared-expense-add · shared-expense, shared-split, shared-payer") {
    let shell = HouseholdSpecimen.shell()
    return SpecimenHost(shell: shell) {
        if let model = HouseholdSpecimen.model(shell) {
            SharedExpenseFormSheet(request: .new, model: model).task { await model.refresh() }
        }
    }
}

#Preview("shared-expense-detail") {
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) {
        NavigationStack { HouseholdExpenseView(householdID: PreviewHouseholds.home, expenseID: "costco") }
    }
}

#Preview("iphone-record-payment · record-share") {
    let shell = HouseholdSpecimen.shell()
    return SpecimenHost(shell: shell) {
        if let model = HouseholdSpecimen.model(shell) {
            PaymentSheet(request: .share(PreviewHouseholds.hydro, from: PreviewHouseholds.me), model: model)
                .task { await model.refresh() }
        }
    }
}

#Preview("record-monthly · payment-stale (record to see it)") {
    let shell = HouseholdSpecimen.shell()
    return SpecimenHost(shell: shell) {
        if let model = HouseholdSpecimen.model(shell) {
            PaymentSheet(
                request: .monthly(PreviewHouseholds.recap.suggestions[0], month: MonthKey(Specimen.today)),
                model: model
            )
            .task { await model.refresh() }
        }
    }
}

#Preview("iphone-history · history") {
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) { NavigationStack { HouseholdHistoryView(householdID: PreviewHouseholds.home) } }
}

#Preview("ipad-shared") {
    let shell = HouseholdSpecimen.shell()
    SpecimenHost(shell: shell) {
        NavigationSplitView {
            SharedView()
        } detail: {
            NavigationStack { HouseholdDetailView(id: PreviewHouseholds.home) }
        }
    }
}
