public import Foundation
public import PennyDomain

/// One account's durable offline ledger and its sync with the server (MAZ-71). See
/// docs/ios-offline-sync.md.
///
/// - **Save.** `commit` applies a `LedgerChange` to the local ledger, materializes due
///   recurrence, checks the result against the server's rules and writes `{base, local}` to
///   disk *before* it returns. A failed write throws and changes nothing.
/// - **Sync.** One sync at a time per account; a second caller joins the one running. A sync
///   reads the server ledger, merges the pending work onto it (`LedgerMerge`), materializes,
///   and writes it on the revision it read. A 409 re-reads and re-merges, up to
///   `ConflictRetryPolicy.maxAttempts` times. Saves made while a sync runs are merged onto
///   its result and synced by another pass.
/// - **Isolation.** The engine only ever touches its own account's file, accepts only a
///   client of its own account, and does nothing after `remove()`, so a late answer cannot
///   recreate a removed account's data or reach another account.
/// - **Holds.** While its data is being removed (`beginRemoval`, sign-out) or moved to a new
///   email (`beginMove`), the engine refuses saves, recurrence catch-up and new syncs, so no
///   save is acknowledged and then deleted or left behind. `endHold()` lifts a hold that did
///   not finish.
public actor LedgerSyncEngine {
    public nonisolated let scope: AccountScope
    private let files: LedgerFileStore
    private let today: @Sendable () -> PennyDomain.CalendarDate
    private let now: @Sendable () -> Date
    private let retry: ConflictRetryPolicy

    private var snapshot: LocalLedgerSnapshot?
    private var storage: LedgerStorageCondition = .notLoaded
    private var running: Task<SyncOutcome, Never>?
    private var lastOutcome: SyncOutcome?
    private var observers: [UUID: AsyncStream<LedgerEngineState>.Continuation] = [:]
    /// Removals and moves in progress (`beginRemoval`, `beginMove`); saves and syncs are
    /// refused while any is.
    private var holds = 0

    /// Passes per sync: the first plus at most two for saves made while it ran.
    static let maxPasses = 3

    public init(
        scope: AccountScope, files: LedgerFileStore, today: @escaping @Sendable () -> PennyDomain.CalendarDate,
        now: @escaping @Sendable () -> Date = { Date() }, retry: ConflictRetryPolicy = .standard
    ) {
        self.scope = scope
        self.files = files
        self.today = today
        self.now = now
        self.retry = retry
    }

    // MARK: State

    public var state: LedgerEngineState {
        LedgerEngineState(
            scope: scope, snapshot: snapshot, storage: storage, isSyncing: running != nil, lastOutcome: lastOutcome)
    }

    /// The current state, then every change, until the engine is removed or the stream ends.
    public func updates() -> AsyncStream<LedgerEngineState> {
        let (stream, continuation) = AsyncStream.makeStream(
            of: LedgerEngineState.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        observers[id] = continuation
        continuation.yield(state)
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeObserver(id) }
        }
        return stream
    }

    private func removeObserver(_ id: UUID) { observers[id] = nil }

    private func publish() {
        let state = self.state
        for observer in observers.values { observer.yield(state) }
    }

    /// Reads the copy on this device once. Later calls return the result of the first
    /// successful read; an unavailable file (locked device) is read again next time.
    @discardableResult
    public func load() -> LedgerStorageCondition {
        switch storage {
        case .notLoaded, .unavailable:
            do {
                snapshot = try files.load(scope)
                storage = .ready
            } catch {
                storage = LedgerStorageCondition(error)
            }
            publish()
        default: break
        }
        return storage
    }

    /// Changes not yet acknowledged by the server. A copy that cannot be read counts as one,
    /// so sign-out never removes it without asking.
    public func pendingChangeCount() -> Int {
        switch load() {
        case .ready: snapshot?.pending.count ?? 0
        case .removed: 0
        case .notLoaded, .unavailable, .unreadable, .newerFormat: 1
        }
    }

    // MARK: Save

    /// Applies `change` to the local ledger and records it durably before returning the new
    /// snapshot. Due recurrence is materialized with the device's local date.
    @discardableResult
    public func commit(_ change: LedgerChange) throws(LedgerSaveError) -> LocalLedgerSnapshot {
        guard holds == 0 else { throw .unavailable }
        switch load() {
        case .ready: break
        case .unreadable, .newerFormat: throw .storageUnreadable
        case .removed: throw .unavailable
        case .notLoaded, .unavailable: throw .notLoaded
        }
        guard var next = snapshot else { throw .notLoaded }
        let changed: Ledger
        do {
            changed = try change.apply(to: next.local)
        } catch {
            throw .rule(error)
        }
        let local = Recurrence.materialize(changed, today: today())
        // Only problems this change introduces: a ledger that already breaks a rule (the 2100
        // recurrence limit, docs/ios-ledger-domain.md) must not block every later save.
        let existing = Set(next.local.violations)
        let violations = local.violations.filter { !existing.contains($0) }
        guard violations.isEmpty else { throw .invalid(violations) }
        next.local = local
        do {
            try files.save(next, for: scope)
        } catch {
            throw .writeFailed
        }
        snapshot = next
        publish()
        return next
    }

    /// Records occurrences that came due (after a day change, or at launch) without a save
    /// from the person. Does nothing when nothing is due or the copy is not ready. As with
    /// `commit`, only problems the catch-up introduces stop it, so a ledger that already
    /// breaks a rule still catches up.
    public func materializeDueOccurrences() {
        guard holds == 0, load() == .ready, var next = snapshot else { return }
        let local = Recurrence.materialize(next.local, today: today())
        guard local != next.local else { return }
        let existing = Set(next.local.violations)
        guard local.violations.allSatisfy({ existing.contains($0) }) else { return }
        next.local = local
        guard (try? files.save(next, for: scope)) != nil else { return }
        snapshot = next
        publish()
    }

    // MARK: Sync

    /// Syncs with the server using `client`, which must belong to this account. Joins a sync
    /// that is already running instead of starting a second one.
    @discardableResult
    public func sync(using client: APIClient) async -> SyncOutcome {
        if let running { return await running.value }
        guard holds == 0 else { return .notReady }
        let task = Task { await self.runToEnd(client) }
        running = task
        publish()
        let outcome = await task.value
        publish()
        return outcome
    }

    /// Runs the sync and ends it in the same actor step as its last pass, so no caller can
    /// join a sync that has already finished. (Ending it only when the first caller resumed
    /// left a window in which `recoverUnreadableCopy` joined the `.notReady` sync that had run
    /// on the unreadable copy, and the ledger was never downloaded again.) The end is
    /// published when that caller resumes, as before.
    private func runToEnd(_ client: APIClient) async -> SyncOutcome {
        let outcome = await run(client)
        running = nil
        if storage != .removed { lastOutcome = outcome }
        return outcome
    }

    private func run(_ client: APIClient) async -> SyncOutcome {
        guard client.scope == scope else { return .notReady }
        switch load() {
        case .ready: break
        default: return .notReady
        }
        var passes = 0
        while true {
            passes += 1
            let outcome = await pass(client)
            guard outcome == .synced, let snapshot, snapshot.hasPendingChanges, passes < Self.maxPasses else {
                return outcome
            }
        }
    }

    /// One fetch / merge / write round, with conflict retries.
    private func pass(_ client: APIClient) async -> SyncOutcome {
        do {
            var server = try await client.ledger()
            guard storage == .ready else { return .notReady }
            var attempt = 1
            while true {
                let captured = snapshot
                let remote = try Ledger(wire: server.ledger)
                var merged = remote
                if let captured, captured.hasPendingChanges {
                    merged = LedgerMerge.merge(base: captured.base, local: captured.local, remote: remote)
                }
                merged = Recurrence.materialize(merged, today: today())
                if merged == remote { return finish(revision: server.revision, remote: remote, captured: captured) }
                let violations = merged.violations
                guard violations.isEmpty else { return .failed(.rejected(message: nil)) }
                do {
                    server = try await client.putLedger(
                        LedgerSnapshot(revision: server.revision, ledger: WireLedger(merged)))
                    guard storage == .ready else { return .notReady }
                    return finish(
                        revision: server.revision, remote: try Ledger(wire: server.ledger), captured: captured)
                } catch APIError.conflict {
                    guard attempt < retry.maxAttempts else { return .failed(.conflictRetriesExhausted) }
                    await retry.delay(attempt)
                    attempt += 1
                    try Task.checkCancellation()
                    server = try await client.ledger()
                    guard storage == .ready else { return .notReady }
                }
            }
        } catch is CancellationError {
            return .cancelled
        } catch let error as APIError {
            if error.requiresSignIn { return .sessionExpired }
            return .failed(SyncIssue.from(error))
        } catch is LedgerMappingError {
            return .failed(.incompatibleServerData)
        } catch {
            return .failed(.serverUnavailable(retryAfter: nil))
        }
    }

    /// The server now holds `remote` at `revision`, which includes everything in `captured`.
    /// Saves made since `captured` stay pending on top of it.
    private func finish(revision: Int, remote: Ledger, captured: LocalLedgerSnapshot?) -> SyncOutcome {
        guard storage == .ready else { return .notReady }
        var local = remote
        if let current = snapshot, let captured, current.local != captured.local {
            local = Recurrence.materialize(
                LedgerMerge.merge(base: captured.local, local: current.local, remote: remote), today: today())
        }
        let next = LocalLedgerSnapshot(base: remote, local: local, baseRevision: revision, lastSyncedAt: now())
        do {
            try files.save(next, for: scope)
        } catch {
            return .failed(.storageWriteFailed)
        }
        snapshot = next
        publish()
        return .synced
    }

    // MARK: Recovery and removal

    /// Moves an unreadable copy aside (kept on disk until the account is removed) and starts
    /// again from the server. Only for `.unreadable`; a newer format is left alone.
    public func recoverUnreadableCopy(using client: APIClient) async -> SyncOutcome {
        guard holds == 0 else { return .notReady }
        guard storage == .unreadable else { return storage == .ready ? await sync(using: client) : .notReady }
        do {
            try files.setAside(scope)
        } catch {
            return .failed(.storageWriteFailed)
        }
        snapshot = nil
        storage = .ready
        publish()
        return await sync(using: client)
    }

    /// Takes over another scope's snapshot (the same account under a new email): its pending
    /// work is merged onto what this scope already holds.
    func adopt(_ other: LocalLedgerSnapshot) throws(LedgerStoreError) {
        switch load() {
        case .ready: break
        case .unavailable: throw .unavailable
        case .newerFormat(let format): throw .newerFormat(format)
        default: throw .unreadable
        }
        var next = other
        if let mine = snapshot {
            next = mine
            if other.hasPendingChanges {
                next.local = Recurrence.materialize(
                    LedgerMerge.merge(base: other.base, local: other.local, remote: mine.local), today: today())
            }
        }
        try files.save(next, for: scope)
        snapshot = next
        publish()
    }

    /// The snapshot as stored, for `adopt`.
    func storedSnapshot() throws(LedgerStoreError) -> LocalLedgerSnapshot? {
        switch load() {
        case .ready: return snapshot
        case .removed: return nil
        case .unavailable: throw .unavailable
        case .newerFormat(let format): throw .newerFormat(format)
        case .unreadable, .notLoaded: throw .unreadable
        }
    }

    /// Starts a removal (sign-out): refuses saves from now on and returns the pending count
    /// in the same step, so the count the person agrees to lose is the count `remove()`
    /// deletes; no save can land in between. Balance with `remove()` or `endHold()`.
    public func beginRemoval() -> Int {
        holds += 1
        return pendingChangeCount()
    }

    /// Starts a move to another scope (email change): refuses saves and new syncs, waits for
    /// a sync in flight, then returns the snapshot to `adopt`. Nothing can change it until
    /// `remove()` or `endHold()`. On a throw the hold is already lifted.
    func beginMove() async throws(LedgerStoreError) -> LocalLedgerSnapshot? {
        holds += 1
        if let running { _ = await running.value }
        do {
            return try storedSnapshot()
        } catch {
            endHold()
            throw error
        }
    }

    /// Lifts a hold from `beginRemoval` or `beginMove` that did not end in `remove()`
    /// (sign-out refused or failed, move failed).
    public func endHold() {
        holds = max(0, holds - 1)
    }

    /// Removes the account's data from this device and stops: a sync in flight is cancelled
    /// and its answer is dropped. Called by sign-out after the person agreed.
    public func remove() throws(LedgerStoreError) {
        running?.cancel()
        try files.remove(scope)
        snapshot = nil
        storage = .removed
        lastOutcome = nil
        publish()
        for observer in observers.values { observer.finish() }
        observers = [:]
    }
}
