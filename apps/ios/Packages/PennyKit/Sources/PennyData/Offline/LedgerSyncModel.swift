public import Foundation
public import Observation
public import PennyDomain

/// What the sync banner, pending rows and save feedback show (redesign cards "Offline" and
/// "Save error"; docs/ios-offline-sync.md). The UI binds to `LedgerSyncModel.state`.
public struct LedgerSyncState: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        /// No account is signed in.
        case signedOut
        /// Reading this device's copy, or downloading the ledger for the first time.
        case loading
        /// Everything on this device is on the server.
        case upToDate
        /// A sync is running.
        case syncing
        /// Changes are saved on this device and a sync will send them shortly.
        case pending
        /// No network: changes are saved on this device and sync when it returns.
        case offline
        /// The last sync failed; `SyncIssue` says why and whether it retries by itself.
        case failed(SyncIssue)
        /// The server ended the session. Changes stay on this device (`pending`) and sync
        /// after the same account signs in again.
        case sessionExpired
        /// This device's copy is locked (before first unlock); it is read again on foreground.
        case storageUnavailable
        /// This device's copy cannot be read. Offer `recoverUnreadableStorage()`; saving is
        /// refused until then. Sign-out counts it as pending.
        case storageUnreadable
        /// This device's copy was written by a newer app version. Update the app.
        case storageNewerFormat
    }

    public var phase: Phase
    /// The changes not yet on the server: `count` for "N changes waiting", `entryIDs` for
    /// the rows marked "Waiting to sync".
    public var pending: PendingChanges
    /// When the server last confirmed this device's ledger ("as of last sync").
    public var lastSyncedAt: Date?
    /// The account the state describes (also for `.sessionExpired`).
    public var scope: AccountScope?

    public init(phase: Phase, pending: PendingChanges, lastSyncedAt: Date?, scope: AccountScope?) {
        self.phase = phase
        self.pending = pending
        self.lastSyncedAt = lastSyncedAt
        self.scope = scope
    }

    public static let signedOut = LedgerSyncState(phase: .signedOut, pending: .none, lastSyncedAt: nil, scope: nil)

    public var hasPendingChanges: Bool { !pending.isEmpty }
}

/// The result of a save: it is on this device's disk. `savedOffline` says whether it is
/// waiting for the network ("Saved on this device") rather than about to sync.
public struct SaveReceipt: Equatable, Sendable {
    public let scope: AccountScope
    public let savedOffline: Bool
    public let pendingCount: Int
    /// This device's ledger right before and right after the save, read together: the
    /// difference is this change and the recurring entries it made due, nothing else.
    public let before: Ledger
    public let after: Ledger
}

/// What to do with a server search page (docs/reference/search.md, "Offline, pending edits").
public enum SearchReconciliation: Equatable, Sendable {
    /// Show the page: nothing changed locally since the search started.
    case show(SearchPage)
    /// The ledger changed (save or sync) or the account changed since the search started:
    /// drop the page and search again.
    case searchAgain
    /// Pending changes or no network: search this device's ledger (`localSearch`) instead,
    /// so an unsynced create, edit or delete is neither hidden nor revived.
    case useLocalResults
}

/// The observable offline ledger for the signed-in account (MAZ-71). It follows
/// `AuthController`: it opens the account's `LedgerSyncEngine` on sign-in, keeps showing
/// nothing of an account after it signs out or switches, and reports a 401 back through
/// `AuthController.sessionDidExpire(for:)`.
///
/// Sync triggers: sign-in and launch, every save, the network returning, the app becoming
/// active (`sceneDidBecomeActive()`), a calendar day change (due recurrence) and a manual
/// `syncNow()`. Failures that can pass retry with `SyncBackoff`; a rejected write waits for
/// the next save or `syncNow()`.
///
/// Shared household actions and receipt uploads are online-only: they go straight through
/// `AuthController.client` and are never queued here. Gate them on `canUseOnlineOnlyActions`.
@MainActor
@Observable
public final class LedgerSyncModel {
    public private(set) var state: LedgerSyncState = .signedOut
    /// The ledger to show: the server's plus this device's unsynced changes. Nil while
    /// signed out or before the first download.
    public private(set) var ledger: Ledger?
    /// Whether the device has a network path (not whether the server answers).
    public private(set) var isOnline = true
    /// Changes whenever `ledger` changes or the account changes. Tag a server search with
    /// it and pass it back to `reconcile(_:startedAt:)`.
    public private(set) var searchEpoch = 0

    @ObservationIgnored private let auth: AuthController
    @ObservationIgnored private let store: OfflineLedgerStore
    @ObservationIgnored private let network: any NetworkMonitoring
    @ObservationIgnored private let calendar: any CalendarDayMonitoring
    @ObservationIgnored private var started = false
    @ObservationIgnored private let backoff: SyncBackoff
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private var account: SignedInAccount?
    @ObservationIgnored private var engine: LedgerSyncEngine?
    @ObservationIgnored private var engineState: LedgerEngineState?
    @ObservationIgnored private var savesAllowed = false
    @ObservationIgnored private var expired: (scope: AccountScope, pending: PendingChanges, lastSyncedAt: Date?)?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var failures = 0
    @ObservationIgnored private var engineUpdates: Task<Void, Never>?
    @ObservationIgnored private var retry: Task<Void, Never>?
    /// Until when the server asked to wait (Retry-After on a 429 or 503). Saves, the network
    /// returning and the app becoming active wait for it; `syncNow()` does not.
    @ObservationIgnored private var serverWaitUntil: ContinuousClock.Instant?
    @ObservationIgnored private var monitors: [Task<Void, Never>] = []

    public init(
        auth: AuthController, store: OfflineLedgerStore, network: any NetworkMonitoring = SystemNetworkMonitor(),
        calendar: any CalendarDayMonitoring = SystemCalendarDayMonitor(), backoff: SyncBackoff = SyncBackoff(),
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.auth = auth
        self.store = store
        self.network = network
        self.calendar = calendar
        self.backoff = backoff
        self.sleep = sleep
    }

    /// Starts following the account, the network and the calendar. Creating the model does
    /// nothing by itself (SwiftUI may create and discard several), so call this once the
    /// model is the one in use; `View.ledgerSync(_:)` does. Later calls do nothing.
    public func start() {
        guard !started else { return }
        started = true
        let reachability = network.reachability()
        let days = calendar.dayChanges()
        monitors = [
            Task { [weak self] in
                for await reachable in reachability { self?.networkChanged(reachable) }
            },
            Task { [weak self] in
                for await _ in days { await self?.dayChanged() }
            },
        ]
        observeAuth()
    }

    isolated deinit {
        for task in monitors { task.cancel() }
        engineUpdates?.cancel()
        retry?.cancel()
    }

    /// Whether shared actions and receipt uploads (online-only) can run now.
    public var canUseOnlineOnlyActions: Bool {
        guard isOnline, account != nil, savesAllowed else { return false }
        switch state.phase {
        case .sessionExpired, .signedOut: return false
        default: return true
        }
    }

    /// Whether search should use this device's ledger instead of server pages
    /// (`LocalSearch.searchesLocally`).
    public var searchesLocally: Bool {
        LocalSearch.searchesLocally(hasPendingChanges: state.hasPendingChanges, isOnline: isOnline)
    }

    // MARK: Save

    /// Saves a change to this device's ledger. It is on disk when this returns; a sync then
    /// sends it. On failure nothing changed: keep the draft and show `LedgerSaveError.message`.
    @discardableResult
    public func save(_ change: LedgerChange) async throws(LedgerSaveError) -> SaveReceipt {
        // `auth.state` is checked here too: the model hears of a change to it one main-actor
        // turn later (`observeAuth`), and a save in that turn must not land once the session
        // has ended.
        if case .signingOut(let signingOut) = auth.state, signingOut.scope == account?.scope { throw .signingOut }
        guard let engine, let account, savesAllowed, case .signedIn(let signedIn) = auth.state,
            signedIn.scope == account.scope
        else { throw .unavailable }
        let current = generation
        let (before, snapshot) = try await engine.commitChange(change)
        // Show the saved ledger now rather than when the update stream delivers it.
        let saved = await engine.state
        if current == generation { apply(saved) }
        let waitingForNetwork: Bool
        switch state.phase {
        case .offline, .failed(.offline), .failed(.serverUnreachable): waitingForNetwork = true
        default: waitingForNetwork = !isOnline
        }
        requestSync()
        return SaveReceipt(
            scope: account.scope, savedOffline: waitingForNetwork, pendingCount: snapshot.pending.count,
            before: before, after: snapshot.local)
    }

    // MARK: Sync triggers

    /// "Retry": syncs now, even when the network monitor reports no path or the server asked
    /// to wait, and resets backoff.
    public func syncNow() {
        failures = 0
        serverWaitUntil = nil
        requestSync(force: true)
    }

    /// Call when the scene becomes active: reads a copy that was locked, records occurrences
    /// that came due and syncs.
    public func sceneDidBecomeActive() {
        guard let engine else { return }
        let current = generation
        Task {
            await engine.load()
            await engine.materializeDueOccurrences()
            guard current == generation else { return }
            requestSync()
        }
    }

    /// Call when the scene goes to the background: stops retry timers (they restart on the
    /// next activation). Work already saved stays on disk.
    public func sceneDidEnterBackground() {
        retry?.cancel()
        retry = nil
    }

    /// Moves an unreadable copy aside and downloads the ledger again. Changes that only
    /// existed in that copy cannot be read back; the file is kept until the account is removed.
    public func recoverUnreadableStorage() async {
        guard let engine, let account, let client = auth.client, client.scope == account.scope else { return }
        let current = generation
        let outcome = await engine.recoverUnreadableCopy(using: client)
        guard current == generation else { return }
        handle(outcome, for: account)
    }

    private func networkChanged(_ reachable: Bool) {
        let returned = reachable && !isOnline
        isOnline = reachable
        refreshState()
        if returned {
            failures = 0
            requestSync()
        }
    }

    private func dayChanged() async {
        guard let engine else { return }
        let current = generation
        await engine.materializeDueOccurrences()
        guard current == generation else { return }
        requestSync()
    }

    private func requestSync(force: Bool = false) {
        guard let engine, let account, savesAllowed, let client = auth.client, client.scope == account.scope
        else { return }
        guard isOnline || force else { return }
        if !force, let until = serverWaitUntil {
            let remaining = until - ContinuousClock.now
            if remaining > .zero {
                // The server asked to wait: sync when the wait ends, not now.
                if retry == nil { scheduleRetry(after: remaining) }
                return
            }
            serverWaitUntil = nil
        }
        retry?.cancel()
        retry = nil
        let current = generation
        Task {
            let outcome = await engine.sync(using: client)
            guard current == generation else { return }
            handle(outcome, for: account)
        }
    }

    private func handle(_ outcome: SyncOutcome, for account: SignedInAccount) {
        switch outcome {
        case .synced:
            failures = 0
            serverWaitUntil = nil
            // Saves kept arriving while the sync ran (it stops after a few passes): send the
            // rest shortly rather than waiting for the next trigger.
            if engineState?.pending.isEmpty == false { scheduleRetry(after: backoff.initial) }
        case .sessionExpired:
            auth.sessionDidExpire(for: account)
        case .failed(let issue):
            failures += 1
            guard issue.retriesAutomatically else { break }
            var retryAfter: TimeInterval?
            if case .serverUnavailable(let after) = issue { retryAfter = after }
            let delay = backoff.delay(afterFailures: failures, retryAfter: retryAfter)
            if let retryAfter, retryAfter > 0 { serverWaitUntil = .now + delay }
            scheduleRetry(after: delay)
        case .notReady, .cancelled:
            break
        }
        refreshState()
    }

    private func scheduleRetry(after delay: Duration) {
        retry?.cancel()
        let current = generation
        let sleep = self.sleep
        retry = Task {
            do { try await sleep(delay) } catch { return }
            guard !Task.isCancelled, current == generation else { return }
            retry = nil
            requestSync()
        }
    }

    // MARK: Account binding

    /// Follows `auth.state`: runs `authChanged()` now and after every change.
    private func observeAuth() {
        withObservationTracking {
            _ = auth.state
        } onChange: { [weak self] in
            Task { @MainActor in self?.observeAuth() }
        }
        authChanged()
    }

    private func authChanged() {
        switch auth.state {
        case .signedIn(let signedIn):
            savesAllowed = true
            if let account, account.scope == signedIn.scope, account.generation == signedIn.generation {
                self.account = signedIn
                return
            }
            bind(signedIn)
        case .signingOut(let signingOut):
            // The account stays visible until sign-out ends, but nothing new is saved.
            savesAllowed = account?.scope == signingOut.scope ? false : savesAllowed
            refreshState()
        case .signedOut(.sessionExpired):
            unbind(expired: true)
        case .signedOut, .restoring, .keychainUnavailable, .signingIn:
            unbind(expired: false)
        }
    }

    private func bind(_ signedIn: SignedInAccount) {
        unbind(expired: false)
        generation += 1
        let current = generation
        account = signedIn
        savesAllowed = true
        expired = nil
        state = LedgerSyncState(phase: .loading, pending: .none, lastSyncedAt: nil, scope: signedIn.scope)
        let store = self.store
        Task { [weak self] in
            let engine = await store.engine(for: signedIn.scope)
            await self?.attach(engine, generation: current)
        }
    }

    private func attach(_ engine: LedgerSyncEngine, generation current: Int) async {
        guard current == generation else { return }
        self.engine = engine
        let updates = await engine.updates()
        guard current == generation else { return }
        engineUpdates = Task { [weak self] in
            for await update in updates {
                guard let self, current == self.generation else { return }
                self.apply(update)
            }
        }
        await engine.load()
        await engine.materializeDueOccurrences()
        guard current == generation else { return }
        requestSync()
    }

    private func unbind(expired wasExpired: Bool) {
        if wasExpired, let account, expired == nil {
            expired = (account.scope, engineState?.pending ?? .none, engineState?.snapshot?.lastSyncedAt)
        }
        if account != nil || engine != nil { generation += 1 }
        engineUpdates?.cancel()
        engineUpdates = nil
        retry?.cancel()
        retry = nil
        account = nil
        engine = nil
        engineState = nil
        savesAllowed = false
        failures = 0
        serverWaitUntil = nil
        if ledger != nil {
            ledger = nil
            searchEpoch += 1
        }
        if !wasExpired { expired = nil }
        refreshState()
    }

    private func apply(_ update: LedgerEngineState) {
        engineState = update
        let next = update.snapshot?.local
        if next != ledger {
            ledger = next
            searchEpoch += 1
        }
        refreshState()
    }

    private func refreshState() {
        guard let account else {
            if let expired {
                state = LedgerSyncState(
                    phase: .sessionExpired, pending: expired.pending, lastSyncedAt: expired.lastSyncedAt,
                    scope: expired.scope)
            } else {
                state = .signedOut
            }
            return
        }
        guard let engineState else {
            state = LedgerSyncState(phase: .loading, pending: .none, lastSyncedAt: nil, scope: account.scope)
            return
        }
        let pending = engineState.pending
        let phase: LedgerSyncState.Phase
        switch engineState.storage {
        case .unavailable: phase = .storageUnavailable
        case .unreadable: phase = .storageUnreadable
        case .newerFormat: phase = .storageNewerFormat
        case .removed: phase = .signedOut
        case .notLoaded: phase = .loading
        case .ready:
            if engineState.isSyncing {
                phase = .syncing
            } else {
                switch engineState.lastOutcome {
                case .failed(.offline): phase = .offline
                case .failed(let issue): phase = isOnline ? .failed(issue) : .offline
                // A 401 unbinds the account (`handle`), so an engine still reporting one
                // while an account is bound is left from the session that ended: this
                // sign-in replaced it. Show the ledger as it is now instead.
                case .synced, .cancelled, .notReady, .sessionExpired, nil:
                    if !isOnline {
                        phase = .offline
                    } else if engineState.snapshot == nil {
                        phase = .loading
                    } else {
                        phase = pending.isEmpty ? .upToDate : .pending
                    }
                }
            }
        }
        state = LedgerSyncState(
            phase: phase, pending: pending, lastSyncedAt: engineState.snapshot?.lastSyncedAt, scope: account.scope)
    }

    // MARK: Drafts

    /// The kept entry drafts of `scope` (`LedgerFileStore.loadDrafts`).
    public func keptDrafts(for scope: AccountScope) -> EntryDraftShelf { store.files.loadDrafts(scope) }

    /// Stores the kept entry drafts of `scope`, while it is the signed-in account: a shell
    /// closing after sign-out must not write drafts back for an account just removed.
    public func keepDrafts(_ shelf: EntryDraftShelf, for scope: AccountScope) {
        guard account?.scope == scope, savesAllowed else { return }
        try? store.files.saveDrafts(shelf, for: scope)
    }

    // MARK: Search

    /// Whole-ledger local search over this device's ledger, pending changes included
    /// (`LedgerReport.search`). Shared projections are not cached on the device yet, so
    /// offline results are personal entries only.
    public func localSearch(_ query: String, kind: EntryKind? = nil, day: PennyDomain.CalendarDate? = nil)
        -> [ReportEntry]
    {
        guard let ledger else { return [] }
        return LedgerReport(ledger: ledger).search(query, kind: kind, day: day)
    }

    /// Decides what to do with a server page for a search started at `epoch`.
    public func reconcile(_ page: SearchPage, startedAt epoch: Int) -> SearchReconciliation {
        guard epoch == searchEpoch, let account, page.scope == account.scope else { return .searchAgain }
        if searchesLocally { return .useLocalResults }
        return .show(page)
    }
}
