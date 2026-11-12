public import Foundation
public import Observation
public import PennyDomain

/// Where a shared read stands. A failure keeps whatever was read before, so the screen can
/// still show it with the reason it may be out of date.
public enum HouseholdLoad: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case failed(HouseholdFailure)

    public var failure: HouseholdFailure? {
        if case .failed(let failure) = self { return failure }
        return nil
    }
}

/// The Shared tab's list (MAZ-75): every household the account has joined, with the viewer's
/// balance for the current month, plus create and join. Online only: nothing here is kept on
/// disk, and a failed read keeps the last list with the reason.
///
/// One per signed-in shell. Unsaved shared-expense drafts live here too (`drafts`), so a draft
/// survives closing its sheet, a failed save or a deep link, for the rest of the session.
@MainActor
@Observable
public final class HouseholdDirectory {
    public private(set) var households: [WireHousehold] = []
    /// The viewer's balance in each household's current month, when it could be read.
    public private(set) var balances: [String: Int64] = [:]
    public private(set) var memberInitials: [String: [String]] = [:]
    public private(set) var load: HouseholdLoad = .idle
    /// Unsaved shared expense and rule drafts, by `SharedExpenseDraft.Key`.
    public var drafts: [SharedExpenseDraft.Key: SharedExpenseDraft] = [:]

    @ObservationIgnored public let service: (any HouseholdService)?
    @ObservationIgnored public let email: String
    @ObservationIgnored private let month: () -> MonthKey
    @ObservationIgnored private let timezoneOffset: () -> Int

    public init(
        service: (any HouseholdService)?, email: String, month: @escaping () -> MonthKey,
        timezoneOffset: @escaping () -> Int = { LocalTimeZone.offsetMinutes() }
    ) {
        self.service = service
        self.email = email
        self.month = month
        self.timezoneOffset = timezoneOffset
    }

    /// False in the demo: it has no server, so no households.
    public var isAvailable: Bool { service != nil }

    public var currentMonth: MonthKey { month() }

    /// Reads the list, then each household's members and current month for the row balance.
    /// A row whose month can't be read just has no balance.
    public func refresh() async {
        guard let service else { return }
        if load == .loading { return }
        load = .loading
        do {
            let list = try await service.households()
            households = list
            let month = month()
            let email = email
            var balances: [String: Int64] = [:]
            var initials: [String: [String]] = [:]
            await withTaskGroup(of: (String, Int64?, [String]).self) { group in
                for household in list {
                    group.addTask {
                        async let detail = try? service.household(id: household.id)
                        async let recap = try? service.monthRecap(householdId: household.id, month: month)
                        let people = await detail.map { HouseholdPeople(members: $0.members, email: email) }
                        let balance = await recap.map { $0.balance(of: people?.meId) }
                        let letters = people.map { people in people.current.map { people.initials($0.userId) } } ?? []
                        return (household.id, balance, letters)
                    }
                }
                for await (id, balance, letters) in group {
                    if let balance { balances[id] = balance }
                    initials[id] = letters
                }
            }
            self.balances = balances
            memberInitials = initials
            load = .loaded
        } catch is CancellationError {
            load = households.isEmpty ? .idle : .loaded
        } catch {
            load = .failed(HouseholdFailure(error))
        }
    }

    /// The viewer's net across the households whose month could be read.
    public var overallBalance: Int64 { balances.values.reduce(0, +) }

    /// Households the list returned. A household that is readable but no longer listed was
    /// archived (or the viewer never joined it).
    public func isListed(_ id: String) -> Bool { households.contains { $0.id == id } }

    /// Creates a household in the ledger currency. The viewer becomes its creator.
    public func create(name: String, currency: Currency) async -> Result<WireHousehold, HouseholdFailure> {
        guard let service else { return .failure(HouseholdFailure(.offline, HouseholdFailure.offlineMessage)) }
        guard SharedText.required(name, maxLength: 80) != nil else {
            return .failure(HouseholdFailure(.invalid, "Give the household a name of up to 80 characters."))
        }
        do {
            let household = try await service.createHousehold(
                name: name, currency: currency, timezoneOffsetMinutes: timezoneOffset())
            households.insert(household, at: 0)
            return .success(household)
        } catch {
            return .failure(HouseholdFailure(error))
        }
    }

    /// Joins with a code. One code works for several people until it expires or is replaced.
    public func join(_ code: InviteCode) async -> Result<WireHousehold, HouseholdFailure> {
        guard let service else { return .failure(HouseholdFailure(.offline, HouseholdFailure.offlineMessage)) }
        do {
            let household = try await service.joinHousehold(code: code, timezoneOffsetMinutes: timezoneOffset())
            households.removeAll { $0.id == household.id }
            households.insert(household, at: 0)
            return .success(household)
        } catch {
            return .failure(HouseholdFailure(error))
        }
    }

    /// After leaving or archiving: the household leaves the list (a former member can still
    /// open it from a link to read their history).
    public func forget(_ id: String) {
        households.removeAll { $0.id == id }
        balances[id] = nil
        drafts = drafts.filter { $0.key.householdId != id }
    }

    @ObservationIgnored private var models: [String: HouseholdModel] = [:]

    /// The one page model for household `id` this session, shared by the household page, its
    /// expenses and its sheets, so a write in one shows in the others. Nil in the demo.
    public func model(for id: String) -> HouseholdModel? {
        guard let service else { return nil }
        if let model = models[id] { return model }
        let model = HouseholdModel(id: id, service: service, email: email, month: month(), directory: self)
        models[id] = model
        return model
    }

    /// Replaces a row after a rename or a member change.
    public func update(_ household: WireHousehold) {
        if let index = households.firstIndex(where: { $0.id == household.id }) { households[index] = household }
    }
}

/// One household's page (MAZ-75): members, the month's expenses, balances and suggestions,
/// shared rules, the invite and the membership actions. Every write goes to the server and
/// then the page reads again, because balances, suggestions and restrictions are the server's.
@MainActor
@Observable
public final class HouseholdModel {
    public let id: String
    public private(set) var detail: WireHouseholdDetail?
    public private(set) var people: HouseholdPeople
    public private(set) var month: MonthKey
    public private(set) var recap: WireMonthRecap?
    public private(set) var rules: [WireSharedRule] = []
    /// The newest code this device created, while it is valid.
    public private(set) var invite: WireInvite?
    /// When the invite stops working, on this device's clock: it arrived with the server's
    /// fixed 10-minute lifetime, so a device clock that differs from the server's can't make
    /// the countdown wrong (never later than the server's own `expiresAt` would allow).
    public private(set) var inviteExpiresAt: Date?
    public private(set) var load: HouseholdLoad = .idle
    /// Archived: readable, but nothing can change (inferred from its absence from the list).
    public private(set) var isArchived = false
    /// What the last write failed with, shown on the page until the next action.
    public var notice: HouseholdFailure?
    /// Bumped after every successful write, so the shell can refresh Home's shares.
    public private(set) var writeCount = 0

    @ObservationIgnored public let service: any HouseholdService
    @ObservationIgnored public let directory: HouseholdDirectory?
    @ObservationIgnored private let email: String

    public init(
        id: String, service: any HouseholdService, email: String, month: MonthKey,
        directory: HouseholdDirectory? = nil
    ) {
        self.id = id
        self.service = service
        self.email = email
        self.month = month
        self.directory = directory
        people = HouseholdPeople(members: [], email: email)
    }

    public var household: WireHousehold? { detail?.household }
    public var isCreator: Bool { household.map(people.isCreator) ?? false }
    /// Archived, or the viewer left or was removed: history stays readable, nothing changes.
    public var isReadOnly: Bool { isArchived || !people.viewerIsCurrent }
    public var currency: String { household?.currency ?? Currency.cad.rawValue }
    public var expenses: [WireSharedExpense] { recap?.expenses ?? [] }
    public var viewerBalance: Int64 { recap?.balance(of: people.meId) ?? 0 }

    /// Why nothing can be changed here, when that's the case.
    public var readOnlyReason: String? {
        if isArchived { return "This household is archived. Its history stays readable; nothing can change." }
        if detail != nil, !people.viewerIsCurrent {
            return "You're no longer a member. You can still read the expenses you shared."
        }
        return nil
    }

    @ObservationIgnored private var refreshing: Task<Void, Never>?
    @ObservationIgnored private var refreshRequested = false
    /// Bumped whenever the month on screen changes, so an answer for an earlier choice is dropped.
    @ObservationIgnored private var monthGeneration = 0
    /// The current month when the person last chose a month themselves (nil while following it).
    @ObservationIgnored private var chosenDuring: MonthKey?

    /// Reads the household, its month, its rules and whether it's still listed. A refresh asked
    /// for while one runs (a save finishing during a pull to refresh) runs again after it, and
    /// every caller waits for the read that includes its change.
    public func refresh() async {
        if let running = refreshing {
            refreshRequested = true
            await running.value
            return
        }
        let task = Task { [weak self] in
            guard let self else { return }
            repeat {
                self.refreshRequested = false
                await self.readOnce()
            } while self.refreshRequested
        }
        refreshing = task
        await task.value
        refreshing = nil
    }

    /// Follows the calendar: a page opened again after the month rolled over shows the new
    /// current month, unless the person chose a month themselves since that rollover.
    public func followCurrentMonth(_ current: MonthKey) {
        if let chosenDuring, chosenDuring == current { return }
        chosenDuring = nil
        guard month != current else { return }
        month = current
        monthGeneration += 1
        recap = nil
    }

    private func readOnce() async {
        load = .loading
        let requested = month
        let generation = monthGeneration
        do {
            async let detail = service.household(id: id)
            async let recap = service.monthRecap(householdId: id, month: requested)
            async let rules = service.sharedRules(householdId: id)
            async let listed = service.households()
            let loaded = try await detail
            self.detail = loaded
            people = HouseholdPeople(members: loaded.members, email: email)
            isArchived = !(try await listed).contains { $0.id == id }
            do {
                let answer = try await recap
                // The person moved to another month meanwhile: that month's own read shows it.
                if generation == monthGeneration { self.recap = answer }
            } catch let error as APIError {
                // A former member asking for a month after they left: no rows, not a failure.
                guard case .notFound = error else { throw error }
                if generation == monthGeneration { self.recap = WireMonthRecap(month: "\(requested)") }
            }
            self.rules = (try? await rules) ?? []
            directory?.update(loaded.household)
            load = .loaded
        } catch is CancellationError {
            load = detail == nil ? .idle : .loaded
        } catch {
            load = .failed(HouseholdFailure(error))
        }
    }

    /// Shows another month. Answers arrive in any order; only the one for the month still on
    /// screen is kept, so a quick ‹ ‹ never shows October's balances under September.
    public func show(month next: MonthKey, current: MonthKey? = nil) async {
        guard next != month else { return }
        chosenDuring = current ?? chosenDuring ?? month
        month = next
        monthGeneration += 1
        let generation = monthGeneration
        recap = nil
        do {
            let answer = try await service.monthRecap(householdId: id, month: next)
            guard generation == monthGeneration else { return }
            recap = answer
        } catch is CancellationError {
        } catch {
            guard generation == monthGeneration else { return }
            if case .notFound = error as? APIError, detail != nil {
                recap = WireMonthRecap(month: "\(next)")
            } else {
                notice = HouseholdFailure(error)
            }
        }
    }

    // MARK: Membership

    public func rename(_ name: String) async -> HouseholdFailure? {
        await write {
            let household = try await self.service.renameHousehold(id: self.id, name: name)
            self.detail?.household = household
            self.directory?.update(household)
        }
    }

    /// Creates a new code (replacing the previous one) for 10 minutes.
    public func newInvite() async -> HouseholdFailure? {
        await write(refreshing: false) {
            // Stamped before sending: the code can't outlive the server's 10 minutes on screen.
            let sent = Date()
            let invite = try await self.service.createInvite(householdId: self.id)
            self.invite = invite
            self.inviteExpiresAt = sent.addingTimeInterval(InviteCode.lifetime)
        }
    }

    /// Forgets the invite once it has expired.
    public func expireInvite(now: Date = Date()) {
        if invite != nil, let inviteExpiresAt, inviteExpiresAt <= now {
            invite = nil
            self.inviteExpiresAt = nil
        }
    }

    public func leave() async -> HouseholdFailure? {
        await write(refreshing: false) {
            try await self.service.leaveHousehold(id: self.id)
            self.directory?.forget(self.id)
        }
    }

    public func remove(_ userId: String) async -> HouseholdFailure? {
        await write { try await self.service.removeMember(householdId: self.id, userId: userId) }
    }

    public func archive() async -> HouseholdFailure? {
        await write(refreshing: false) {
            try await self.service.archiveHousehold(id: self.id)
            self.isArchived = true
            self.invite = nil
            self.inviteExpiresAt = nil
            self.directory?.forget(self.id)
        }
    }

    // MARK: Expenses and payments

    /// The expense from this month's recap, if it's there.
    public func expense(_ expenseId: String) -> WireSharedExpense? { expenses.first { $0.id == expenseId } }

    public func loadExpense(_ expenseId: String) async -> Result<WireSharedExpense, HouseholdFailure> {
        do {
            return .success(try await service.sharedExpense(householdId: id, id: expenseId))
        } catch {
            return .failure(HouseholdFailure(error))
        }
    }

    public func deleteExpense(_ expense: WireSharedExpense) async -> HouseholdFailure? {
        await write {
            try await self.service.deleteSharedExpense(householdId: self.id, id: expense.id, revision: expense.revision)
        }
    }

    /// What recording a payment came to.
    public enum PaymentOutcome: Equatable, Sendable {
        case recorded(WireSharedExpense)
        /// The expense changed after it was read: nothing was recorded. `latest` is the
        /// current version (nil when it was deleted), to compare and review.
        case stale(old: WireSharedExpense, latest: WireSharedExpense?)
        case failed(HouseholdFailure)
    }

    /// Records that `fromUserId` already paid their whole share of `expense` outside Penny.
    public func recordShare(_ expense: WireSharedExpense, from fromUserId: String) async -> PaymentOutcome {
        guard !isReadOnly else { return .failed(HouseholdFailure(.membership, readOnlyReason ?? "")) }
        do {
            let updated = try await service.recordSharePayment(
                householdId: id, expenseId: expense.id, fromUserId: fromUserId, revision: expense.revision)
            writeCount += 1
            await reloadMonth()
            return .recorded(updated)
        } catch {
            let failure = HouseholdFailure(error)
            guard failure.kind == .stale || failure.kind == .gone else {
                if failure.kind == .restricted || failure.kind == .membership { await reloadMonth() }
                return .failed(failure)
            }
            let latest = try? await service.sharedExpense(householdId: id, id: expense.id)
            await reloadMonth()
            return .stale(old: expense, latest: latest)
        }
    }

    public enum MonthlyOutcome: Equatable, Sendable {
        case recorded(WireReimbursement)
        /// The suggestion changed (someone recorded it, or an expense changed): nothing was
        /// recorded; `current` is what's suggested now.
        case stale(current: [WireTransfer])
        case failed(HouseholdFailure)
    }

    /// Records a full suggested monthly transfer that already happened outside Penny.
    public func recordMonthly(_ transfer: WireTransfer, month target: MonthKey) async -> MonthlyOutcome {
        guard !isReadOnly else { return .failed(HouseholdFailure(.membership, readOnlyReason ?? "")) }
        do {
            let recorded = try await service.recordMonthlyPayment(householdId: id, month: target, transfer: transfer)
            writeCount += 1
            await reloadMonth()
            return .recorded(recorded)
        } catch {
            let failure = HouseholdFailure(error)
            guard failure.kind == .stale else { return .failed(failure) }
            let current = (try? await service.monthRecap(householdId: id, month: target))?.suggestions ?? []
            await reloadMonth()
            return .stale(current: current)
        }
    }

    /// Suggestions of an earlier, overdue month.
    public func suggestions(for overdue: MonthKey) async -> Result<[WireTransfer], HouseholdFailure> {
        do {
            return .success(try await service.monthRecap(householdId: id, month: overdue).suggestions)
        } catch {
            return .failure(HouseholdFailure(error))
        }
    }

    public func history(expenseId: String? = nil) async -> Result<[WireAuditEvent], HouseholdFailure> {
        do {
            return .success(try await service.householdAudit(householdId: id, expenseId: expenseId))
        } catch {
            return .failure(HouseholdFailure(error))
        }
    }

    // MARK: Shared rules

    /// Pauses or resumes a rule. Resuming with the same next date skips dates that fell due.
    public func setActive(_ rule: WireSharedRule, _ active: Bool) async -> HouseholdFailure? {
        var input = SharedExpenseDraft.ruleInput(from: rule)
        input.active = active
        input.revision = rule.revision
        return await write { _ = try await self.service.updateSharedRule(householdId: self.id, id: rule.id, input) }
    }

    public func deleteRule(_ rule: WireSharedRule) async -> HouseholdFailure? {
        await write {
            try await self.service.deleteSharedRule(householdId: self.id, id: rule.id, revision: rule.revision)
        }
    }

    /// Called by the expense form after it saved.
    public func didSave() async {
        writeCount += 1
        await refresh()
    }

    // MARK: Plumbing

    private func reloadMonth() async {
        let generation = monthGeneration
        if let recap = try? await service.monthRecap(householdId: id, month: month), generation == monthGeneration {
            self.recap = recap
        }
        if let detail = try? await service.household(id: id) {
            self.detail = detail
            people = HouseholdPeople(members: detail.members, email: email)
        }
    }

    private func write(refreshing: Bool = true, _ body: @escaping () async throws -> Void) async
        -> HouseholdFailure?
    {
        guard !isReadOnly else { return HouseholdFailure(.membership, readOnlyReason ?? "") }
        notice = nil
        do {
            try await body()
            writeCount += 1
            if refreshing { await refresh() }
            return nil
        } catch {
            let failure = HouseholdFailure(error)
            notice = failure
            // A stale copy or a membership change: read again so the page shows what's true now.
            if [.stale, .membership, .gone, .restricted].contains(failure.kind) { await refresh() }
            return failure
        }
    }
}
