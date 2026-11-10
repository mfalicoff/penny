public import Foundation
public import PennyDomain

/// "Sync, then sign out" could not send everything; nothing was removed.
public struct PendingSyncFailed: Error, Equatable, Sendable {
    public let outcome: SyncOutcome

    public init(outcome: SyncOutcome) {
        self.outcome = outcome
    }
}

/// Every account's offline ledger on this device: one `LedgerSyncEngine` per `AccountScope`,
/// shared by the sync model and sign-out, so a sync started by either is the same sync.
/// It is the real `AccountLocalData` for `AuthController` (MAZ-68).
public actor OfflineLedgerStore: AccountLocalData {
    public nonisolated let files: LedgerFileStore
    private let today: @Sendable () -> PennyDomain.CalendarDate
    private let now: @Sendable () -> Date
    private let retry: ConflictRetryPolicy
    private var engines: [AccountScope: LedgerSyncEngine] = [:]

    /// - Parameter today: the device's local calendar day, read at every save and sync, so a
    ///   save just after midnight materializes the new day's occurrences.
    public init(
        files: LedgerFileStore,
        today: @escaping @Sendable () -> PennyDomain.CalendarDate = { PennyDomain.CalendarDate(Date()) },
        now: @escaping @Sendable () -> Date = { Date() }, retry: ConflictRetryPolicy = .standard
    ) {
        self.files = files
        self.today = today
        self.now = now
        self.retry = retry
    }

    /// The store in Application Support (`LedgerFileStore.defaultDirectory`).
    public static func standard() -> OfflineLedgerStore {
        OfflineLedgerStore(files: LedgerFileStore(directory: LedgerFileStore.defaultDirectory))
    }

    /// The account's engine, created on first use.
    public func engine(for scope: AccountScope) -> LedgerSyncEngine {
        if let engine = engines[scope] { return engine }
        let engine = LedgerSyncEngine(scope: scope, files: files, today: today, now: now, retry: retry)
        engines[scope] = engine
        return engine
    }

    /// Accounts with a ledger on this device (for example one a sign-out could not remove).
    public nonisolated func storedScopes() -> [AccountScope] { files.storedScopes() }

    // MARK: AccountLocalData

    public func pendingChangeCount(for scope: AccountScope) async -> Int {
        await engine(for: scope).pendingChangeCount()
    }

    /// Syncs and throws unless everything was acknowledged. A 401 is rethrown as
    /// `APIError.unauthorized`, so `AuthController` ends the session.
    public func syncPendingChanges(for scope: AccountScope, using client: APIClient) async throws {
        let engine = engine(for: scope)
        let outcome = await engine.sync(using: client)
        switch outcome {
        case .sessionExpired: throw APIError.unauthorized(message: nil)
        case .synced where await engine.pendingChangeCount() == 0: return
        default: throw PendingSyncFailed(outcome: outcome)
        }
    }

    /// Removes the account's ledger file and any copy set aside. `AuthController` calls this
    /// only after the pending-changes check or the person's "Sign out anyway".
    public func removeLocalData(for scope: AccountScope) async throws {
        try await engine(for: scope).remove()
        engines[scope] = nil
    }

    public func moveLocalData(from old: AccountScope, to new: AccountScope) async throws {
        guard old != new else { return }
        let source = engine(for: old)
        guard let snapshot = try await source.storedSnapshot() else { return }
        try await engine(for: new).adopt(snapshot)
        try await source.remove()
        engines[old] = nil
    }
}
