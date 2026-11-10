import Foundation
public import Observation
public import PennyDomain

/// The temporary demo ("Try with sample data"). Its ledger lives only in this object: it is
/// never written to disk, never sent to a server and never mixed with an account's data, and
/// it is gone when the demo ends. A change keeps working like a real one (rules, toast,
/// Undo), so the demo shows the app honestly.
@MainActor
@Observable
public final class DemoWorkspace: LedgerWorkspace {
    public private(set) var load: LedgerLoad
    public let sync: SyncStatus = .localOnly
    public let pendingEntryIDs: Set<String> = []
    public let isDemo = true

    @ObservationIgnored private var lastChange: (id: UUID, before: Ledger, after: Ledger)?

    public init(today: PennyDomain.CalendarDate) {
        load = .ready(DemoLedger.make(today: today))
    }

    public func commit(_ change: LedgerChange, summary: ChangeSummary) async -> Result<SavedChange, SaveFailure> {
        guard let ledger = load.ledger else { return .failure(.unavailable("The demo has ended.")) }
        do throws(LedgerRuleError) {
            let next = try change.apply(to: ledger)
            let saved = SavedChange(summary: summary, canUndo: true)
            lastChange = (saved.id, ledger, next)
            load = .ready(next)
            return .success(saved)
        } catch {
            return .failure(.rule(error))
        }
    }

    public func undo(_ change: SavedChange) async -> Result<Void, SaveFailure> {
        guard let last = lastChange, last.id == change.id, load.ledger == last.after else {
            return .failure(.unavailable("This change can't be undone anymore."))
        }
        lastChange = nil
        load = .ready(last.before)
        return .success(())
    }

    public func syncNow() async {}
    public func reload() async {}
}

/// A workspace with a fixed state, for previews, specimens and tests: offline with pending
/// rows, a failing server, a failed load, or a save that fails. It never stores anything.
@MainActor
@Observable
public final class FixedWorkspace: LedgerWorkspace {
    public var load: LedgerLoad
    public var sync: SyncStatus
    public var pendingEntryIDs: Set<String>
    public var isDemo: Bool
    /// When set, every commit fails with it (the save-error state).
    public var saveFailure: SaveFailure?
    public private(set) var syncRequests = 0
    public private(set) var reloadRequests = 0
    public private(set) var commits: [ChangeSummary] = []

    public init(
        load: LedgerLoad, sync: SyncStatus = .upToDate(lastSynced: nil), pendingEntryIDs: Set<String> = [],
        isDemo: Bool = false, saveFailure: SaveFailure? = nil
    ) {
        self.load = load
        self.sync = sync
        self.pendingEntryIDs = pendingEntryIDs
        self.isDemo = isDemo
        self.saveFailure = saveFailure
    }

    public func commit(_ change: LedgerChange, summary: ChangeSummary) async -> Result<SavedChange, SaveFailure> {
        if let saveFailure { return .failure(saveFailure) }
        guard let ledger = load.ledger else { return .failure(.unavailable("Nothing to save to.")) }
        do throws(LedgerRuleError) {
            load = .ready(try change.apply(to: ledger))
            commits.append(summary)
            return .success(SavedChange(summary: summary, canUndo: false))
        } catch {
            return .failure(.rule(error))
        }
    }

    public func undo(_ change: SavedChange) async -> Result<Void, SaveFailure> {
        .failure(.unavailable("This change can't be undone anymore."))
    }

    public func syncNow() async { syncRequests += 1 }
    public func reload() async { reloadRequests += 1 }
}
