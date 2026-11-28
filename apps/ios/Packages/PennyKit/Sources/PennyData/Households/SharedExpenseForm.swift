import Foundation
public import Observation
public import PennyDomain

/// What the shared expense form holds (MAZ-75): a new or edited expense, or a shared repeating
/// rule. The values stay as typed (amount and split texts) so a failed save or a closed sheet
/// gives them back exactly; `validate` turns them into the request body.
///
/// The split preview uses `HouseholdSplit`, the server's own rounding, so "your share" on the
/// form is what the server will store. Participants are the members active on the date
/// (households) or every current member (trips and rules); a paid expense keeps the members it
/// was paid with.
public struct SharedExpenseDraft: Equatable, Sendable {
    /// Where a draft is kept between sheets.
    public struct Key: Hashable, Sendable {
        public var householdId: String
        /// The expense or rule being edited; nil for a new one.
        public var itemId: String?
        public var isRule: Bool

        public init(householdId: String, itemId: String?, isRule: Bool) {
            self.householdId = householdId
            self.itemId = itemId
            self.isRule = isRule
        }
    }

    /// The form fields, for restoring focus with a restored draft.
    public enum Field: String, Hashable, Sendable {
        case amount, title, note, split
    }

    public var householdId: String
    public var amountText: String
    public var title: String
    public var date: PennyDomain.CalendarDate
    public var payerId: String
    public var mode: SharedSplitMode
    /// Exact amounts as typed, by member id.
    public var exactTexts: [String: String]
    /// Percentages as typed ("33.33"), by member id.
    public var percentTexts: [String: String]
    public var category: WireSharedCategory
    public var note: String
    /// The payer's own private account. Only kept while the viewer is the payer.
    public var accountId: String?
    /// The viewer's account while someone else is chosen as payer, restored if the viewer is
    /// chosen again. Never sent.
    public var setAsideAccountId: String?
    /// New expenses only: repeat as a shared rule instead (its first date is `date`).
    public var repeats: RecurrenceFrequency?
    /// Rules: whether the rule is running.
    public var active: Bool
    /// The receipt linked to the expense (MAZ-256): uploaded or chosen in Receipt, repeat, note,
    /// or kept from the edited expense. Expenses only; a rule keeps its own.
    public var receipt: ReceiptReference?
    public var focus: Field?
    /// The household's currency (MAZ-151 phase 2: any ISO 4217 code): the total, the splits and
    /// the balances are in it. Nil reads amounts with two decimals.
    public var currency: String?
    /// The currency the expense was paid in when it isn't the household's: `amountText` is typed in
    /// it, and the total is it converted at `rate` (household units per unit), rounded once. Exact
    /// split amounts stay in the household's currency. Nil: paid in the household's currency.
    public var paidCurrency: String?
    public var rate: String?
    public var rateStatus: RateStatus?
    /// The publication of a published or provisional rate.
    public var rateDate: PennyDomain.CalendarDate?

    /// What is being edited, nil for a new expense or rule.
    public var original: Original?

    public enum Original: Equatable, Sendable {
        case expense(WireSharedExpense)
        case rule(WireSharedRule)

        public var id: String {
            switch self {
            case .expense(let expense): expense.id
            case .rule(let rule): rule.id
            }
        }

        public var revision: Int {
            switch self {
            case .expense(let expense): expense.revision
            case .rule(let rule): rule.revision
            }
        }
    }

    public var isRule: Bool {
        if case .rule = original { return true }
        return original == nil && repeats != nil
    }

    public var key: Key { Key(householdId: householdId, itemId: original?.id, isRule: isEditingRule) }

    public var isEditingRule: Bool {
        if case .rule = original { return true }
        return false
    }

    /// A paid expense keeps its payer, total, month and shares (`Paid expenses cannot …`).
    public var isPaidExpense: Bool {
        if case .expense(let expense) = original { return expense.isPaid }
        return false
    }

    /// A new expense paid by the viewer, split equally, dated `today`.
    public init(
        householdId: String, payerId: String, today: PennyDomain.CalendarDate, category: WireSharedCategory
    ) {
        self.householdId = householdId
        amountText = ""
        title = ""
        date = today
        self.payerId = payerId
        mode = .equal
        exactTexts = [:]
        percentTexts = [:]
        self.category = category
        note = ""
        accountId = nil
        repeats = nil
        active = true
        focus = .amount
        original = nil
    }

    /// Editing a recorded expense, with its stored split as typed values. `currency` is the
    /// household's, for amounts with other than two decimals.
    public init(editing expense: WireSharedExpense, viewerId: String?, currency: String? = nil) {
        householdId = expense.householdId
        self.currency = currency
        amountText = Self.amountText(expense.totalCents, currency: currency)
        if let code = expense.originalCurrency, let original = expense.originalAmount, let rate = expense.rate,
            let status = expense.paidRateStatus, Currencies.isCurrency(code)
        {
            // MAZ-151 phase 2: paid in another currency, typed again as it was paid.
            paidCurrency = code
            amountText = Self.amountText(original, currency: code)
            self.rate = rate
            rateStatus = status
            rateDate = expense.rateDate.flatMap(PennyDomain.CalendarDate.init)
        }
        title = expense.title
        date = PennyDomain.CalendarDate(expense.date) ?? .earliest
        payerId = expense.payerUserId
        mode = expense.mode
        exactTexts = Dictionary(
            uniqueKeysWithValues: expense.splits.map {
                ($0.userId, Self.amountText($0.amountCents, currency: currency))
            })
        percentTexts = [:]
        if expense.mode == .percent {
            // The server keeps the computed shares, not the percentages: start from the shares.
            mode = .exact
        }
        category = expense.category
        note = expense.note
        accountId = viewerId == expense.payerUserId ? expense.accountId : nil
        repeats = nil
        active = true
        focus = nil
        original = .expense(expense)
        receipt =
            expense.receipt.map { ReceiptReference(id: $0.id, name: $0.name, uri: $0.uri, mime: $0.mime) }
            ?? expense.receiptId.map { ReceiptReference(id: $0, name: "Receipt", uri: "", mime: "") }
    }

    /// Editing a shared rule. Rules stay in the household's currency.
    public init(editing rule: WireSharedRule, viewerId: String?, currency: String? = nil) {
        householdId = rule.householdId
        self.currency = currency
        amountText = Self.amountText(rule.totalCents, currency: currency)
        title = rule.title
        date = PennyDomain.CalendarDate(rule.nextDate) ?? .earliest
        payerId = rule.payerUserId
        mode = SharedSplitMode(rawValue: rule.splitMode) ?? .equal
        var exact: [String: String] = [:]
        var percent: [String: String] = [:]
        for allocation in rule.allocations ?? [] {
            if let cents = allocation.amountCents {
                exact[allocation.userId] = Self.amountText(cents, currency: currency)
            }
            if let points = allocation.percentBasisPoints {
                percent[allocation.userId] = HouseholdSplit.percentText(points)
            }
        }
        exactTexts = exact
        percentTexts = percent
        category = rule.category
        note = rule.note
        accountId = viewerId == rule.payerUserId ? rule.accountId : nil
        repeats = RecurrenceFrequency(rawValue: rule.frequency) ?? .monthly
        active = rule.active
        focus = nil
        original = .rule(rule)
    }

    public static func amountText(_ cents: Int64) -> String {
        let fraction = cents % 100
        return "\(cents / 100).\(fraction < 10 ? "0" : "")\(fraction)"
    }

    /// `minor` units of `currency` as typed: "1200" in yen, "12.000" in dinars, "12.00" otherwise.
    public static func amountText(_ minor: Int64, currency: String?) -> String {
        let units = currency.flatMap(Currencies.info)?.minorUnits ?? 2
        guard units != 2 else { return amountText(minor) }
        guard units > 0 else { return "\(minor)" }
        var scale: Int64 = 1
        for _ in 0..<units { scale *= 10 }
        let fraction = String(minor % scale)
        return "\(minor / scale).\(String(repeating: "0", count: units - fraction.count))\(fraction)"
    }

    /// Minor units typed in the household's currency (two decimals without one).
    func householdCents(_ text: String) -> Int64? {
        guard let currency, Currencies.isCurrency(currency) else { return try? Money.cents(text) }
        return try? Currencies.parseAmount(text, currency: currency)
    }

    // MARK: Paid in another currency (MAZ-151 phase 2)

    /// The household's currency, or nil when it isn't known.
    public var householdCurrency: String? { currency }

    /// Paid in another currency than the household's.
    public var isForeign: Bool { paidCurrency != nil }

    /// The amount paid in `paidCurrency`'s minor units, when it is foreign and can be read.
    public var originalAmount: Int64? {
        guard let paidCurrency else { return nil }
        return try? Currencies.parseAmount(amountText, currency: paidCurrency)
    }

    /// Chooses the currency it was paid in: the household's clears the foreign fields. The amount
    /// keeps its digits (those beyond the new currency's decimals go) and the rate is looked up
    /// again. A foreign expense can't repeat (rules stay in the household's currency).
    public mutating func setPaidCurrency(_ code: String?) {
        let next = code == currency ? nil : code
        guard next != paidCurrency else { return }
        paidCurrency = next
        let units = (next ?? currency).flatMap(Currencies.info)?.minorUnits ?? 2
        amountText = AmountInput.fitting(amountText, minorUnits: units)
        rate = nil
        rateStatus = nil
        rateDate = nil
        if next != nil { repeats = nil }
    }

    /// Puts a looked-up or typed rate on the draft. A looked-up rate never replaces an edited one.
    public mutating func applyRate(_ choice: RateChoice) {
        if choice.status != .edited, rateStatus == .edited { return }
        rate = choice.rate
        rateStatus = choice.status
        rateDate = choice.status == .edited ? nil : choice.date
    }

    /// The decimals the amount is typed with.
    public var amountMinorUnits: Int { (paidCurrency ?? currency).flatMap(Currencies.info)?.minorUnits ?? 2 }

    // MARK: Participants and preview

    /// Who the expense is split among.
    public func participants(people: HouseholdPeople, household: WireHousehold) -> [WireHouseholdMember] {
        if case .expense(let expense) = original, expense.isPaid {
            let ids = Set(expense.splits.map(\.userId))
            return people.members.filter { ids.contains($0.userId) }.sorted { $0.userId < $1.userId }
        }
        if isRule { return people.current.sorted { $0.userId < $1.userId } }
        return people.eligible(on: date, household: household).sorted { $0.userId < $1.userId }
    }

    /// Why the draft can't be saved yet, in words the form shows.
    public enum Problem: Error, Equatable, Sendable {
        case title
        case amount
        case payer
        case noMembers
        /// Exact amounts don't reach the total: `remaining` cents (negative when over).
        case exactRemaining(Int64)
        /// Percentages don't reach 100%: `remaining` basis points (negative when over).
        case percentRemaining(Int64)
        case splitValue(memberId: String)
        case note
        /// Paid in another currency with no rate yet.
        case rate

        public func message(money: (Int64) -> String) -> String {
            switch self {
            case .title: "Give the expense a name of up to 100 characters."
            case .amount: "Enter an amount above zero, with up to two decimals."
            case .payer: "The person who paid must be a member on that date."
            case .noMembers: "Nobody was a member on that date. Choose another date."
            case .exactRemaining(let left) where left > 0:
                "\(money(left)) left to assign. Shares must add up to the total."
            case .exactRemaining(let left): "\(money(-left)) too much. Shares must add up to the total."
            case .percentRemaining(let left) where left > 0:
                "\(HouseholdSplit.percentText(left))% left to assign. Percentages must add up to 100%."
            case .percentRemaining(let left):
                "\(HouseholdSplit.percentText(-left))% too much. Percentages must add up to 100%."
            case .splitValue: "Enter each share as an amount or a percentage."
            case .note: "Keep the note under 1,000 characters."
            case .rate: "Enter the exchange rate."
            }
        }
    }

    /// The total in the household's currency: typed, or what was paid converted at the rate.
    public var totalCents: Int64? {
        let cents: Int64?
        if let paidCurrency {
            guard let original = originalAmount, let rate, let household = currency else { return nil }
            cents = try? Currencies.convertAmount(original, from: paidCurrency, rate: rate, home: household)
        } else {
            cents = householdCents(amountText)
        }
        guard let cents, (1...HouseholdSplit.maxTotal).contains(cents) else { return nil }
        return cents
    }

    /// The shares as the server will compute them, or why they don't work yet.
    public func preview(participants: [WireHouseholdMember]) -> Result<[SharedShare], Problem> {
        guard let total = totalCents else { return .failure(.amount) }
        let ids = participants.map(\.userId)
        guard !ids.isEmpty else { return .failure(.noMembers) }
        switch mode {
        case .equal:
            do { return .success(try HouseholdSplit.equal(total: total, memberIds: ids)) } catch {
                return .failure(.noMembers)
            }
        case .exact:
            var amounts: [String: Int64] = [:]
            for id in ids {
                let text = exactTexts[id] ?? ""
                if text.trimmingCharacters(in: .whitespaces).isEmpty {
                    amounts[id] = 0
                    continue
                }
                guard let cents = householdCents(text) else { return .failure(.splitValue(memberId: id)) }
                amounts[id] = cents
            }
            let sum = amounts.values.reduce(0, +)
            guard sum == total else { return .failure(.exactRemaining(total - sum)) }
            do { return .success(try HouseholdSplit.exact(total: total, amounts: amounts)) } catch {
                return .failure(.exactRemaining(total - sum))
            }
        case .percent:
            var points: [String: Int64] = [:]
            for id in ids {
                let text = percentTexts[id] ?? ""
                if text.trimmingCharacters(in: .whitespaces).isEmpty {
                    points[id] = 0
                    continue
                }
                guard let value = HouseholdSplit.basisPoints(text) else { return .failure(.splitValue(memberId: id)) }
                points[id] = value
            }
            let sum = points.values.reduce(0, +)
            guard sum == HouseholdSplit.wholeBasisPoints else {
                return .failure(.percentRemaining(HouseholdSplit.wholeBasisPoints - sum))
            }
            do { return .success(try HouseholdSplit.percent(total: total, basisPoints: points)) } catch {
                return .failure(.percentRemaining(0))
            }
        }
    }

    /// Switching to exact or percent starts from an even split, so the fields add up already.
    public mutating func switchMode(_ next: SharedSplitMode, participants: [WireHouseholdMember]) {
        guard next != mode else { return }
        let ids = participants.map(\.userId).sorted()
        if next == .exact, let total = totalCents, let shares = try? HouseholdSplit.equal(total: total, memberIds: ids)
        {
            exactTexts = Dictionary(
                uniqueKeysWithValues: shares.map { ($0.userId, Self.amountText($0.amountCents, currency: currency)) })
        }
        if next == .percent, !ids.isEmpty {
            let shares = (try? HouseholdSplit.equal(total: HouseholdSplit.wholeBasisPoints, memberIds: ids)) ?? []
            percentTexts = Dictionary(
                uniqueKeysWithValues: shares.map { ($0.userId, HouseholdSplit.percentText($0.amountCents)) })
        }
        mode = next
    }

    /// The payer changed: a private account belongs to the viewer only, so it is dropped
    /// unless the viewer still pays.
    public mutating func choosePayer(_ id: String, viewerId: String?) {
        payerId = id
        if id != viewerId {
            if accountId != nil { setAsideAccountId = accountId }
            accountId = nil
        } else if accountId == nil, let setAside = setAsideAccountId {
            // Back to the viewer: their account comes back, so saving doesn't clear the link.
            accountId = setAside
            setAsideAccountId = nil
        }
    }

    // MARK: Request bodies

    public struct Valid: Equatable, Sendable {
        public var title: String
        public var totalCents: Int64
        public var shares: [SharedShare]
        public var allocations: [WireAllocation]?
    }

    public func validate(participants: [WireHouseholdMember]) -> Result<Valid, Problem> {
        guard let title = SharedText.required(title, maxLength: 100) else { return .failure(.title) }
        if isForeign, originalAmount != nil, rate == nil { return .failure(.rate) }
        guard let total = totalCents else { return .failure(.amount) }
        guard note.utf16.count <= 1000 else { return .failure(.note) }
        guard participants.contains(where: { $0.userId == payerId }) else { return .failure(.payer) }
        let shares: [SharedShare]
        switch preview(participants: participants) {
        case .success(let value): shares = value
        case .failure(let problem): return .failure(problem)
        }
        let allocations: [WireAllocation]?
        switch mode {
        case .equal: allocations = nil
        case .exact: allocations = shares.map { .amount($0.userId, $0.amountCents) }
        case .percent:
            allocations = participants.map(\.userId).sorted().map { id in
                .percent(id, HouseholdSplit.basisPoints(percentTexts[id] ?? "") ?? 0)
            }
        }
        return .success(Valid(title: title, totalCents: total, shares: shares, allocations: allocations))
    }

    public func expenseInput(_ valid: Valid, viewerId: String?, timezoneOffset: Int) -> WireExpenseInput {
        var input = WireExpenseInput(
            title: valid.title, totalCents: valid.totalCents, date: date.description, payerUserId: payerId,
            splitMode: mode.rawValue, allocations: valid.allocations, category: category, note: note,
            accountId: payerId == viewerId ? accountId : nil, receiptId: receiptId,
            timezoneOffsetMinutes: timezoneOffset, revision: original.map(\.revision))
        // MAZ-151 phase 2: what was paid, with the rate the total was converted at.
        if let paidCurrency, let originalAmount, let rate, let rateStatus {
            input.originalAmount = originalAmount
            input.originalCurrency = paidCurrency
            input.rate = rate
            input.rateStatus = rateStatus.rawValue
            input.rateDate = rateStatus == .edited ? nil : rateDate?.description
        }
        return input
    }

    public func ruleInput(_ valid: Valid, viewerId: String?, timezoneOffset: Int) -> WireRuleInput {
        var input = WireRuleInput(
            title: valid.title, totalCents: valid.totalCents, payerUserId: payerId, splitMode: mode.rawValue,
            allocations: valid.allocations, category: category, note: note,
            accountId: payerId == viewerId ? accountId : nil, timezoneOffsetMinutes: timezoneOffset,
            frequency: (repeats ?? .monthly).rawValue, nextDate: date.description)
        if case .rule(let rule) = original {
            input.active = active
            input.revision = rule.revision
            input.receiptId = rule.receiptId
        }
        return input
    }

    /// The linked receipt: attached in the form, or kept from the edited expense. Removing it sends
    /// none, as the web does.
    private var receiptId: String? { receipt?.id }

    /// A rule's own values as an update body (pause and resume change only `active`).
    public static func ruleInput(from rule: WireSharedRule) -> WireRuleInput {
        WireRuleInput(
            title: rule.title, totalCents: rule.totalCents, payerUserId: rule.payerUserId, splitMode: rule.splitMode,
            allocations: rule.allocations, category: rule.category, note: rule.note, accountId: rule.accountId,
            receiptId: rule.receiptId, frequency: rule.frequency, nextDate: rule.nextDate, active: rule.active,
            revision: rule.revision)
    }
}

/// The shared expense form's save flow: validate, send once, keep the draft on every failure,
/// and turn a stale revision into "someone changed this" with Review latest.
@MainActor
@Observable
public final class SharedExpenseFormModel {
    public var draft: SharedExpenseDraft
    public private(set) var problem: SharedExpenseDraft.Problem?
    public private(set) var failure: HouseholdFailure?
    /// Set when the server refused a stale edit: the expense or rule as it is now (nil when
    /// it was deleted).
    public private(set) var latest: SharedExpenseDraft.Original?
    public private(set) var isStale = false
    public private(set) var isSaving = false
    /// What the server stored, once a save succeeded. A second Save returns it without sending.
    public private(set) var saved: Outcome?
    /// Said once a save went through: the receipt was gone from the server, so it was saved
    /// without it (MAZ-199). Nil otherwise.
    public private(set) var notice: String?
    /// Bumped when a save is refused, for the error haptic.
    public private(set) var refusedCount = 0
    /// The draft as it was opened, to know whether closing loses anything.
    @ObservationIgnored public private(set) var opened: SharedExpenseDraft

    @ObservationIgnored public let household: HouseholdModel
    @ObservationIgnored private let timezoneOffset: () -> Int

    public init(
        draft: SharedExpenseDraft, household: HouseholdModel,
        timezoneOffset: @escaping () -> Int = { LocalTimeZone.offsetMinutes() }
    ) {
        var draft = draft
        // MAZ-151 phase 2: amounts are read in the household's currency.
        if draft.currency == nil, let code = household.household?.currency { draft.currency = code }
        self.draft = draft
        opened = draft
        self.household = household
        self.timezoneOffset = timezoneOffset
    }

    public var hasChanges: Bool {
        var a = draft
        var b = opened
        a.focus = nil
        b.focus = nil
        return a != b
    }

    public var participants: [WireHouseholdMember] {
        guard let detail = household.detail else { return [] }
        return draft.participants(people: household.people, household: detail.household)
    }

    public var viewerId: String? { household.people.meId }

    /// The viewer's share in the preview (what counts in their spending), when it adds up.
    public var viewerShare: Int64? {
        guard let viewerId, case .success(let shares) = draft.preview(participants: participants) else { return nil }
        return shares.first { $0.userId == viewerId }?.amountCents ?? 0
    }

    /// The server's refusal of a receipt the household can't use (`SharedExpenseService.ReceiptUnavailable`).
    public nonisolated static let receiptUnavailable = "Receipt is not available to this household."
    /// The same refusal from a server before contract 2.1.0, which sends no `expense.receipt_unavailable`.
    nonisolated static func isReceiptGone(_ error: APIError) -> Bool {
        error.status == 400 && error.message == receiptUnavailable
    }
    public nonisolated static let receiptGoneNotice =
        "The receipt was no longer on the server, so it was saved without it."

    public enum Outcome: Equatable, Sendable {
        case expense(WireSharedExpense)
        case rule(WireSharedRule)
    }

    /// Sends the draft. Nil while it was refused, failed or already saving; the draft stays.
    public func save() async -> Outcome? {
        if let saved { return saved }
        guard !isSaving else { return nil }
        failure = nil
        problem = nil
        notice = nil
        guard !household.isReadOnly else {
            failure = HouseholdFailure(.membership, household.readOnlyReason ?? "")
            refusedCount += 1
            return nil
        }
        let valid: SharedExpenseDraft.Valid
        switch draft.validate(participants: participants) {
        case .success(let value): valid = value
        case .failure(let refused):
            problem = refused
            refusedCount += 1
            return nil
        }
        isSaving = true
        defer { isSaving = false }
        let service = household.service
        do {
            let outcome: Outcome
            do {
                outcome = try await send(valid)
            } catch let error as APIError where error.matches(.expenseReceiptUnavailable, legacy: Self.isReceiptGone) {
                // A receipt kept in a draft longer than the server keeps unlinked uploads was
                // cleaned up (MAZ-199): save without it and say so. Any other answer, or a check
                // that fails, keeps the refusal.
                guard let id = draft.receipt?.id, (try? await service.receiptExists(id: id)) == false else {
                    throw error
                }
                draft.receipt = nil
                outcome = try await send(valid)
                notice = Self.receiptGoneNotice
            }
            // Saved: never send it again, and drop any kept copy of the draft at once (a sheet that
            // closed meanwhile may have kept one). The page reads again in the background, so the
            // sheet closes without waiting for it.
            saved = outcome
            household.directory?.drafts[draft.key] = nil
            let household = household
            Task { await household.didSave() }
            return outcome
        } catch {
            let failure = HouseholdFailure(error)
            self.failure = failure
            refusedCount += 1
            if failure.kind == .stale || failure.kind == .gone {
                isStale = true
                latest = await currentVersion()
            }
            return nil
        }
    }

    /// Sends the draft as it is now.
    private func send(_ valid: SharedExpenseDraft.Valid) async throws -> Outcome {
        let service = household.service
        let householdId = draft.householdId
        switch draft.original {
        case .expense(let expense):
            let input = draft.expenseInput(valid, viewerId: viewerId, timezoneOffset: timezoneOffset())
            return .expense(try await service.updateSharedExpense(householdId: householdId, id: expense.id, input))
        case .rule(let rule):
            let input = draft.ruleInput(valid, viewerId: viewerId, timezoneOffset: timezoneOffset())
            return .rule(try await service.updateSharedRule(householdId: householdId, id: rule.id, input))
        case nil where draft.repeats != nil:
            let input = draft.ruleInput(valid, viewerId: viewerId, timezoneOffset: timezoneOffset())
            return .rule(try await service.createSharedRule(householdId: householdId, input))
        case nil:
            let input = draft.expenseInput(valid, viewerId: viewerId, timezoneOffset: timezoneOffset())
            return .expense(try await service.createSharedExpense(householdId: householdId, input))
        }
    }

    /// After a stale refusal: reopens the form on the current version, keeping nothing of the
    /// refused edit (it was based on a copy that no longer exists). False when it was deleted.
    public func reviewLatest() -> Bool {
        guard let latest else { return false }
        switch latest {
        case .expense(let expense):
            draft = SharedExpenseDraft(editing: expense, viewerId: viewerId, currency: draft.currency)
        case .rule(let rule): draft = SharedExpenseDraft(editing: rule, viewerId: viewerId, currency: draft.currency)
        }
        opened = draft
        isStale = false
        failure = nil
        self.latest = nil
        return true
    }

    /// Keeps the draft for later (closing with changes, or the sheet replaced by a link). A draft
    /// that was already saved is never kept: keeping it would offer to create it again.
    public func keepDraft() {
        guard saved == nil else { return }
        household.directory?.drafts[draft.key] = draft
    }

    public func discardDraft() {
        household.directory?.drafts[draft.key] = nil
    }

    private func currentVersion() async -> SharedExpenseDraft.Original? {
        switch draft.original {
        case .expense(let expense):
            return (try? await household.service.sharedExpense(householdId: draft.householdId, id: expense.id))
                .map(SharedExpenseDraft.Original.expense)
        case .rule(let rule):
            let rules = (try? await household.service.sharedRules(householdId: draft.householdId)) ?? []
            return rules.first { $0.id == rule.id }.map(SharedExpenseDraft.Original.rule)
        case nil:
            return nil
        }
    }
}
