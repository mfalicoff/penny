import Foundation
public import PennyDomain

/// Households, shared expenses, settlement, audit and shared rules (MAZ-56–59 on the server;
/// MAZ-75 here). Every call needs a session and goes straight to the server: shared data is
/// online-only and never kept in the offline ledger. Ids are percent-encoded into one path
/// segment each, so an id can never add segments, a query or a fragment.
///
/// Errors are the usual `APIError` cases; `HouseholdFailure` turns them into what the screens
/// say (a stale revision, a membership change, a restriction). See docs/ios-households.md.
extension APIClient {
    private struct HouseholdEnvelope: Decodable { var household: WireHousehold }
    private struct HouseholdsEnvelope: Decodable { var households: [WireHousehold] }
    private struct ExpenseEnvelope: Decodable { var expense: WireSharedExpense }
    private struct ExpensesEnvelope: Decodable { var expenses: [WireSharedExpense] }
    private struct ReimbursementEnvelope: Decodable { var reimbursement: WireReimbursement }
    private struct EventsEnvelope: Decodable { var events: [WireAuditEvent] }
    private struct RuleEnvelope: Decodable { var rule: WireSharedRule }
    private struct RulesEnvelope: Decodable { var rules: [WireSharedRule] }

    private struct CreateBody: Encodable {
        var name: String
        var currency: String
        var timezoneOffsetMinutes: Int
    }

    private struct JoinBody: Encodable {
        var code: String
        var timezoneOffsetMinutes: Int
    }

    private struct NameBody: Encodable { var name: String }
    private struct RevisionBody: Encodable { var revision: Int }

    private struct PaymentBody: Encodable {
        var fromUserId: String
        var revision: Int
    }

    /// Household names are trimmed and must be 1–80 UTF-16 units (`Invalid household data.`).
    static func householdName(_ name: String) throws(APIError) -> String {
        let trimmed = SharedText.trimmed(name)
        guard (1...80).contains(trimmed.utf16.count) else { throw .invalidRequest(.invalidField("name")) }
        return trimmed
    }

    static func segment(_ id: String, field: String) throws(APIError) -> String {
        let unreserved = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard !id.isEmpty, id.utf16.count <= 100,
            let encoded = id.addingPercentEncoding(withAllowedCharacters: unreserved)
        else { throw .invalidRequest(.invalidField(field)) }
        return encoded
    }

    private func base(_ householdId: String) throws(APIError) -> String {
        "/api/households/\(try Self.segment(householdId, field: "householdId"))"
    }

    // MARK: Membership (MAZ-56)

    /// Households the caller has ever joined, not archived, newest first.
    public func households() async throws -> [WireHousehold] {
        let envelope: HouseholdsEnvelope = try await json(.get, "/api/households")
        return envelope.households
    }

    /// The household and its members (current and former). Readable after archiving.
    public func household(id: String) async throws -> WireHouseholdDetail {
        try await json(.get, try base(id))
    }

    /// Creates a household in `currency`, which must be the caller's ledger currency.
    public func createHousehold(name: String, currency: Currency, timezoneOffsetMinutes: Int) async throws
        -> WireHousehold
    {
        let body = CreateBody(
            name: try Self.householdName(name), currency: currency.rawValue,
            timezoneOffsetMinutes: timezoneOffsetMinutes)
        let envelope: HouseholdEnvelope = try await json(.post, "/api/households", body: body)
        return envelope.household
    }

    /// Joins with a live invite code (rate limited: 20 attempts in 10 minutes).
    public func joinHousehold(code: InviteCode, timezoneOffsetMinutes: Int) async throws -> WireHousehold {
        let body = JoinBody(code: code.value, timezoneOffsetMinutes: timezoneOffsetMinutes)
        let envelope: HouseholdEnvelope = try await json(.post, "/api/households/join", body: body)
        return envelope.household
    }

    /// Creator only.
    public func renameHousehold(id: String, name: String) async throws -> WireHousehold {
        let envelope: HouseholdEnvelope = try await json(
            .patch, try base(id), body: NameBody(name: try Self.householdName(name)))
        return envelope.household
    }

    /// Creator only. Replaces any earlier code; the new one works for 10 minutes.
    public func createInvite(householdId: String) async throws -> WireInvite {
        let invite: WireInvite = try await json(.post, "\(try base(householdId))/invites", body: [String: String]())
        guard InviteCode(typed: invite.code)?.value == invite.code else { throw APIError.malformedResponse }
        return invite
    }

    /// Only with a zero balance in every month; the creator only once alone.
    public func leaveHousehold(id: String) async throws {
        let ok: WireOk = try await json(.post, "\(try base(id))/leave", body: [String: String]())
        guard ok.ok else { throw APIError.malformedResponse }
    }

    /// Creator only; the member must be settled in every month.
    public func removeMember(householdId: String, userId: String) async throws {
        let path = "\(try base(householdId))/members/\(try Self.segment(userId, field: "userId"))"
        let ok: WireOk = try await json(.delete, path)
        guard ok.ok else { throw APIError.malformedResponse }
    }

    /// Creator only; every member settled in every month. Final: the household leaves every list.
    public func archiveHousehold(id: String) async throws {
        let ok: WireOk = try await json(.post, "\(try base(id))/archive", body: [String: String]())
        guard ok.ok else { throw APIError.malformedResponse }
    }

    // MARK: Shared expenses (MAZ-57)

    /// Live expenses the caller can see, newest first; `month` filters to one month.
    public func sharedExpenses(householdId: String, month: MonthKey? = nil) async throws -> [WireSharedExpense] {
        let query = month.map { [URLQueryItem(name: "month", value: "\($0)")] } ?? []
        let envelope: ExpensesEnvelope = try await json(.get, "\(try base(householdId))/expenses", query: query)
        return envelope.expenses
    }

    public func sharedExpense(householdId: String, id: String) async throws -> WireSharedExpense {
        let path = "\(try base(householdId))/expenses/\(try Self.segment(id, field: "expenseId"))"
        let envelope: ExpenseEnvelope = try await json(.get, path)
        return envelope.expense
    }

    public func createSharedExpense(householdId: String, _ input: WireExpenseInput) async throws -> WireSharedExpense {
        var body = input
        body.revision = nil
        let envelope: ExpenseEnvelope = try await json(.post, "\(try base(householdId))/expenses", body: body)
        return envelope.expense
    }

    /// `input.revision` must be the revision the edit is based on; a stale one is `409`.
    public func updateSharedExpense(householdId: String, id: String, _ input: WireExpenseInput) async throws
        -> WireSharedExpense
    {
        guard input.revision != nil else { throw APIError.invalidRequest(.invalidField("revision")) }
        let path = "\(try base(householdId))/expenses/\(try Self.segment(id, field: "expenseId"))"
        let envelope: ExpenseEnvelope = try await json(.put, path, body: input)
        return envelope.expense
    }

    /// Soft delete for everyone. Refused once any share is paid.
    public func deleteSharedExpense(householdId: String, id: String, revision: Int) async throws {
        let path = "\(try base(householdId))/expenses/\(try Self.segment(id, field: "expenseId"))"
        let ok: WireOk = try await json(.delete, path, body: RevisionBody(revision: revision))
        guard ok.ok else { throw APIError.malformedResponse }
    }

    /// Records that `fromUserId` already paid their whole share (outside Penny). It moves no
    /// money and changes nobody's spending.
    public func recordSharePayment(householdId: String, expenseId: String, fromUserId: String, revision: Int)
        async throws -> WireSharedExpense
    {
        let path = "\(try base(householdId))/expenses/\(try Self.segment(expenseId, field: "expenseId"))/payments"
        let envelope: ExpenseEnvelope = try await json(
            .post, path, body: PaymentBody(fromUserId: fromUserId, revision: revision))
        return envelope.expense
    }

    // MARK: Settlement and audit (MAZ-58)

    public func monthRecap(householdId: String, month: MonthKey) async throws -> WireMonthRecap {
        try await json(.get, "\(try base(householdId))/months/\(month)")
    }

    /// Records a full suggested monthly transfer that already happened outside Penny.
    public func recordMonthlyPayment(householdId: String, month: MonthKey, transfer: WireTransfer) async throws
        -> WireReimbursement
    {
        let envelope: ReimbursementEnvelope = try await json(
            .post, "\(try base(householdId))/months/\(month)/reimbursements", body: transfer)
        return envelope.reimbursement
    }

    /// Newest first (at most 500 for the household; every event for one expense).
    public func householdAudit(householdId: String, expenseId: String? = nil) async throws -> [WireAuditEvent] {
        let query = expenseId.map { [URLQueryItem(name: "expenseId", value: $0)] } ?? []
        let envelope: EventsEnvelope = try await json(.get, "\(try base(householdId))/audit", query: query)
        return envelope.events
    }

    // MARK: Shared recurring rules (MAZ-59)

    public func sharedRules(householdId: String) async throws -> [WireSharedRule] {
        let envelope: RulesEnvelope = try await json(.get, "\(try base(householdId))/recurring")
        return envelope.rules
    }

    public func createSharedRule(householdId: String, _ input: WireRuleInput) async throws -> WireSharedRule {
        var body = input
        body.active = nil
        body.revision = nil
        let envelope: RuleEnvelope = try await json(.post, "\(try base(householdId))/recurring", body: body)
        return envelope.rule
    }

    /// `input.active` and `input.revision` are required.
    public func updateSharedRule(householdId: String, id: String, _ input: WireRuleInput) async throws
        -> WireSharedRule
    {
        guard input.revision != nil, input.active != nil else {
            throw APIError.invalidRequest(.invalidField("revision"))
        }
        let path = "\(try base(householdId))/recurring/\(try Self.segment(id, field: "ruleId"))"
        let envelope: RuleEnvelope = try await json(.put, path, body: input)
        return envelope.rule
    }

    public func deleteSharedRule(householdId: String, id: String, revision: Int) async throws {
        let path = "\(try base(householdId))/recurring/\(try Self.segment(id, field: "ruleId"))"
        let ok: WireOk = try await json(.delete, path, body: RevisionBody(revision: revision))
        guard ok.ok else { throw APIError.malformedResponse }
    }
}
