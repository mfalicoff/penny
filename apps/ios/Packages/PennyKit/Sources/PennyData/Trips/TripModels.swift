public import Foundation
public import Observation
public import PennyDomain

/// How a trip change is kept in the personal ledger: `ShellModel.commit` in the app (the durable
/// offline ledger, so a personal trip works offline), or a test double. Nil once kept; otherwise
/// the failure, and nothing changed.
public typealias TripCommit = @MainActor (LedgerChange, ChangeSummary) async -> SaveFailure?

/// Shared trips for the signed-in shell (MAZ-76): create, edit and Share trip. A shared trip is
/// a household with a travel range, so its members, invites, expenses and balances are the
/// household's (`HouseholdDirectory`, `HouseholdModel`); this adds what only trips have, and
/// every trip's whole expense list (a trip's Expenses aren't one month's).
@MainActor
@Observable
public final class TripDirectory {
    @ObservationIgnored public let households: HouseholdDirectory
    @ObservationIgnored private let timezoneOffset: () -> Int
    @ObservationIgnored private var expenseModels: [String: SharedTripExpenses] = [:]

    public init(households: HouseholdDirectory, timezoneOffset: @escaping () -> Int = { LocalTimeZone.offsetMinutes() })
    {
        self.households = households
        self.timezoneOffset = timezoneOffset
    }

    /// A shared trip whose page should open its expense form once (Trip expense from the list).
    public var pendingAdd: String?

    /// Takes `pendingAdd` when it is for `id`.
    public func takePendingAdd(for id: String) -> Bool {
        guard pendingAdd == id else { return false }
        pendingAdd = nil
        return true
    }

    /// False in the demo: no server, so no shared trips.
    public var isAvailable: Bool { households.isAvailable }

    /// Creates an empty shared trip in the ledger currency; the viewer is its organizer.
    public func createShared(_ draft: TripDraft, currency: Currency) async -> Result<WireHousehold, HouseholdFailure> {
        guard let service = households.service else {
            return .failure(HouseholdFailure(.offline, HouseholdFailure.offlineMessage))
        }
        if let problem = draft.firstProblem.flatMap({ draft.problems[$0] }) {
            return .failure(HouseholdFailure(.invalid, problem))
        }
        do {
            let household = try await service.createTrip(
                name: draft.trimmedName, currency: currency, startDate: draft.startDate, endDate: draft.endDate,
                timezoneOffsetMinutes: timezoneOffset())
            households.didAdd(household)
            return .success(household)
        } catch {
            return .failure(HouseholdFailure(error))
        }
    }

    /// The organizer changes the name and dates. No expense, share or membership moves.
    public func updateShared(id: String, _ draft: TripDraft) async -> Result<WireHousehold, HouseholdFailure> {
        guard let service = households.service else {
            return .failure(HouseholdFailure(.offline, HouseholdFailure.offlineMessage))
        }
        if let problem = draft.firstProblem.flatMap({ draft.problems[$0] }) {
            return .failure(HouseholdFailure(.invalid, problem))
        }
        do {
            let household = try await service.updateTrip(
                id: id, name: draft.trimmedName, startDate: draft.startDate, endDate: draft.endDate)
            households.update(household)
            await households.model(for: id)?.refresh()
            return .success(household)
        } catch {
            let failure = HouseholdFailure(error)
            if [.membership, .restricted].contains(failure.kind) { await households.model(for: id)?.refresh() }
            return .failure(failure)
        }
    }

    /// What Share trip came to.
    public enum ShareOutcome: Equatable, Sendable {
        /// The shared trip exists and the personal trip links to it.
        case shared(WireHousehold)
        /// The server refused or couldn't be reached: nothing was created.
        case refused(HouseholdFailure)
        /// The link couldn't be saved here, so the new shared trip was archived again: nothing
        /// is left half done.
        case undone(SaveFailure)
        /// The link failed and so did archiving it again: the shared trip exists, unlinked.
        case leftBehind(WireHousehold, SaveFailure)
    }

    /// Share trip (`share-personal-trip`): creates a shared trip with the personal trip's name
    /// and dates, then links the personal trip to it with the private `sharedHouseholdId`. The
    /// personal trip's expenses are never sent: they stay in the ledger and show only to the
    /// viewer under Only you. If the link can't be kept, the new (empty) trip is archived again.
    public func share(_ trip: Trip, currency: Currency, commit: TripCommit) async -> ShareOutcome {
        guard let service = households.service else {
            return .refused(HouseholdFailure(.offline, HouseholdFailure.offlineMessage))
        }
        guard trip.sharedHouseholdId == nil else {
            return .refused(HouseholdFailure(.invalid, "This trip is already shared."))
        }
        let household: WireHousehold
        do {
            household = try await service.createTrip(
                name: trip.name, currency: currency, startDate: trip.startDate, endDate: trip.endDate,
                timezoneOffsetMinutes: timezoneOffset())
        } catch {
            return .refused(HouseholdFailure(error))
        }
        var linked = trip
        linked.sharedHouseholdId = household.id
        let summary = ChangeSummary(title: "\(trip.name) is shared", detail: "What you added before stays private.")
        if let failure = await commit(.saveTrip(linked, original: trip), summary) {
            do {
                // The trip is new and empty, so archiving it is always allowed.
                try await service.archiveHousehold(id: household.id)
                return .undone(failure)
            } catch {
                households.didAdd(household)
                return .leftBehind(household, failure)
            }
        }
        households.didAdd(household)
        return .shared(household)
    }

    /// The whole expense list of shared trip `id`, shared by its page and sheets. Nil in the demo.
    public func expenses(for id: String) -> SharedTripExpenses? {
        guard let service = households.service else { return nil }
        if let model = expenseModels[id] { return model }
        let model = SharedTripExpenses(id: id, service: service)
        expenseModels[id] = model
        return model
    }
}

/// Every shared expense of one shared trip, whatever its month (MAZ-76): a trip's bookings are
/// often a month before it. Balances still settle month by month (`HouseholdModel`).
@MainActor
@Observable
public final class SharedTripExpenses {
    public let id: String
    /// Newest first, then id.
    public private(set) var expenses: [WireSharedExpense] = []
    public private(set) var load: HouseholdLoad = .idle
    @ObservationIgnored private let service: any HouseholdService
    @ObservationIgnored private var generation = 0

    public init(id: String, service: any HouseholdService) {
        self.id = id
        self.service = service
    }

    /// Reads the list again. An older answer that lands after a newer request is dropped.
    public func refresh() async {
        generation += 1
        let mine = generation
        load = .loading
        do {
            let list = try await service.sharedExpenses(householdId: id, month: nil)
            guard mine == generation else { return }
            expenses = list.sorted { $0.date != $1.date ? $0.date > $1.date : $0.id < $1.id }
            load = .loaded
        } catch is CancellationError {
            if mine == generation { load = expenses.isEmpty ? .idle : .loaded }
        } catch {
            guard mine == generation else { return }
            load = .failed(HouseholdFailure(error))
        }
    }
}

/// New trip and Edit trip (`trip-form`, card `iphone-trip-form`). A personal trip is saved to the
/// durable ledger, so it works offline; with Share with others on, a new trip is created on the
/// server instead (online only). A shared trip's organizer edits its name and dates here. The
/// draft stays as typed through refusals and failures, and the id is made once, so Try again
/// never adds a second trip.
@MainActor
@Observable
public final class TripFormModel {
    public enum Target: Equatable, Sendable {
        case new
        case personal(Trip)
        case shared(WireHousehold)
    }

    /// What a save came to.
    public enum Saved: Equatable, Sendable {
        case personal(Trip)
        case shared(WireHousehold)
        case deleted(Trip)
    }

    public let target: Target
    public var draft: TripDraft {
        didSet {
            // A field the person changed no longer shows its old problem.
            for field in TripDraft.Field.allCases
            where problems[field] != nil && field.value(draft) != field.value(oldValue) {
                problems[field] = nil
            }
        }
    }
    /// Share with others (New trip only).
    public var share = false
    public private(set) var problems: [TripDraft.Field: String] = [:]
    /// Why the last save failed, when it isn't one field's problem.
    public private(set) var failure: String?
    public private(set) var isSaving = false
    @ObservationIgnored private let id: String

    public init(
        target: Target, today: PennyDomain.CalendarDate, makeID: () -> String = { UUID().uuidString.lowercased() }
    ) {
        self.target = target
        switch target {
        case .new:
            draft = TripDraft(startDate: today, endDate: today)
            id = makeID()
        case .personal(let trip):
            draft = TripDraft(trip)
            id = trip.id
        case .shared(let household):
            let range = household.tripRange ?? TripRange(start: today, end: today)
            draft = TripDraft(name: household.name, startDate: range.start, endDate: range.end)
            id = household.id
        }
    }

    public var isNew: Bool { target == .new }
    public var savesShared: Bool {
        switch target {
        case .new: share
        case .personal: false
        case .shared: true
        }
    }

    public var title: String {
        switch target {
        case .new: "New trip"
        case .personal: "Edit trip"
        case .shared: "Edit shared trip"
        }
    }

    public var saveTitle: String {
        switch target {
        case .new: share ? "Create shared trip" : "Create trip"
        case .personal, .shared: "Save"
        }
    }

    /// Checks the fields; returns the first one with a problem, to focus.
    public func check() -> TripDraft.Field? {
        problems = draft.problems
        return draft.firstProblem
    }

    /// Saves the draft. Returns what was saved, or nil with `problems` or `failure` set.
    public func save(commit: TripCommit, trips: TripDirectory?, currency: Currency) async -> Saved? {
        guard !isSaving else { return nil }
        failure = nil
        guard check() == nil else { return nil }
        isSaving = true
        defer { isSaving = false }
        if savesShared {
            guard let trips, trips.isAvailable else {
                failure = "Shared trips need your account and a connection. You can still save a personal trip."
                return nil
            }
            let result: Result<WireHousehold, HouseholdFailure>
            if case .shared(let household) = target {
                result = await trips.updateShared(id: household.id, draft)
            } else {
                result = await trips.createShared(draft, currency: currency)
            }
            switch result {
            case .success(let household): return .shared(household)
            case .failure(let refused):
                failure = refused.message
                return nil
            }
        }
        var original: Trip?
        if case .personal(let trip) = target { original = trip }
        let trip = Trip(
            id: id, name: draft.trimmedName, startDate: draft.startDate, endDate: draft.endDate,
            sharedHouseholdId: original?.sharedHouseholdId)
        let summary = ChangeSummary(title: original == nil ? "Trip added" : "Trip updated", detail: trip.name)
        guard let refused = await commit(.saveTrip(trip, original: original), summary) else { return .personal(trip) }
        if case .rule(.duplicateTripName) = refused {
            problems[.name] = refused.message
        } else {
            failure = refused.message
        }
        return nil
    }

    /// Deletes the personal trip as it was opened. `saveTrip` refuses while any entry is on it.
    public func delete(commit: TripCommit) async -> Saved? {
        guard case .personal(let trip) = target, !isSaving else { return nil }
        isSaving = true
        defer { isSaving = false }
        failure = nil
        let summary = ChangeSummary(title: "Trip deleted", detail: trip.name)
        if let refused = await commit(.saveTrip(trip, original: trip, remove: true), summary) {
            failure = refused.message
            return nil
        }
        return .deleted(trip)
    }

    /// Why Delete trip is unavailable, naming how many expenses are on it; nil when it can go.
    public static func deleteNote(expenseCount: Int) -> String? {
        guard expenseCount > 0 else { return nil }
        let count = expenseCount == 1 ? "1 entry is" : "\(expenseCount) entries are"
        return "\(count) on this trip. Move them to another trip or No trip (Edit entry › Trip) before deleting it."
    }
}

extension TripDraft.Field {
    fileprivate func value(_ draft: TripDraft) -> String {
        switch self {
        case .name: draft.name
        case .startDate: draft.startDate.description
        case .endDate: draft.endDate.description
        }
    }
}
