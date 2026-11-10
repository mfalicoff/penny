public import Foundation
public import Observation
public import PennyDomain

/// What the shell needs from the ledger behind it: the current snapshot, whether changes have
/// reached the server, and a way to save a change. The UI binds only to this protocol.
///
/// Two implementations run in the app: `DemoWorkspace` (the isolated sample data) and
/// `AccountWorkspace`, which presents a signed-in account through the MAZ-71 offline engine
/// (`LedgerSyncModel`); the engine owns persistence, the pending queue, merging and retries.
/// `FixedWorkspace` is for previews and tests. See docs/ios-shell.md, "Sync status".
@MainActor
public protocol LedgerWorkspace: AnyObject, Observable {
    /// The ledger to show.
    var load: LedgerLoad { get }
    /// Whether changes made on this device have reached the server.
    var sync: SyncStatus { get }
    /// Ids of entries saved on this device that the server has not acknowledged yet, so rows
    /// can say "Waiting to sync".
    var pendingEntryIDs: Set<String> { get }
    /// True for the demo: changes are temporary and nothing is ever sent.
    var isDemo: Bool { get }

    /// Applies `change` to the current ledger and keeps it. Succeeds once the change is kept on
    /// this device (offline included); reaching the server is reported through `sync`. A
    /// failure means nothing was kept: the caller keeps the person's draft and shows the
    /// failure's message with its next step.
    func commit(_ change: LedgerChange, summary: ChangeSummary) async -> Result<SavedChange, SaveFailure>
    /// Reverts a change from the save toast's Undo. Fails when the change can no longer be
    /// undone (another change built on it, or it already synced and was changed elsewhere).
    func undo(_ change: SavedChange) async -> Result<Void, SaveFailure>
    /// Retry from the offline or error banner: send pending changes now.
    func syncNow() async
    /// Retry from a load error, or pull to refresh.
    func reload() async
}

/// The ledger behind the shell.
public enum LedgerLoad: Equatable, Sendable {
    /// Nothing to show yet (first load on this device).
    case loading
    case ready(Ledger)
    /// Nothing could be shown. The message names the next step.
    case failed(WorkspaceProblem)
    /// The ledger can't be opened by this build (this device's copy was written by a newer
    /// version of Penny). The message names the next step.
    case unavailable(String)

    public var ledger: Ledger? {
        if case .ready(let ledger) = self { return ledger }
        return nil
    }
}

/// Sync state for the status line in Settings, the offline banner and row badges.
public enum SyncStatus: Equatable, Sendable {
    /// Everything on this device is on the server.
    case upToDate(lastSynced: Date?)
    /// Sending `pending` changes now.
    case syncing(pending: Int)
    /// No connection; `pending` changes are kept on this device and sent when it returns.
    case offline(pending: Int, lastSynced: Date?)
    /// The server was reached but refused or failed; the changes are kept and retried.
    case failing(pending: Int, problem: WorkspaceProblem)
    /// The session ended; pending changes wait until the person signs in again.
    case signInRequired(pending: Int)
    /// The demo: nothing is ever synced.
    case localOnly

    public var pending: Int {
        switch self {
        case .upToDate, .localOnly: 0
        case .syncing(let count), .offline(let count, _), .failing(let count, _), .signInRequired(let count): count
        }
    }

    /// Whether the offline/error banner shows (Home and Activity).
    public var needsAttention: Bool {
        switch self {
        case .upToDate, .syncing, .localOnly: false
        case .offline, .failing, .signInRequired: true
        }
    }
}

public struct WorkspaceProblem: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case offline, unreachable, server, conflict, sessionExpired, storage
        /// This device's copy can't be read. The load error's action downloads the ledger
        /// again (`LedgerWorkspace.reload()`); the unreadable copy is set aside, not deleted.
        case storageUnreadable
    }

    public var kind: Kind
    /// For display; already names the next step.
    public var message: String

    public init(_ kind: Kind, _ message: String) {
        self.kind = kind
        self.message = message
    }
}

/// How a saved change is described in the save toast ("Expense added", "Groceries · $48.90").
public struct ChangeSummary: Equatable, Sendable {
    public var title: String
    public var detail: String?
    /// An entry kind for the toast's icon, if the change is about one entry.
    public var kind: EntryKind?
    public var categoryId: String?

    public init(title: String, detail: String? = nil, kind: EntryKind? = nil, categoryId: String? = nil) {
        self.title = title
        self.detail = detail
        self.kind = kind
        self.categoryId = categoryId
    }
}

public struct SavedChange: Equatable, Identifiable, Sendable {
    public let id: UUID
    public let summary: ChangeSummary
    public let canUndo: Bool

    public init(id: UUID = UUID(), summary: ChangeSummary, canUndo: Bool) {
        self.id = id
        self.summary = summary
        self.canUndo = canUndo
    }
}

public enum SaveFailure: Error, Equatable, Sendable {
    /// A ledger rule refused the change (stale form, removed category, currency locked...).
    case rule(LedgerRuleError)
    /// The change needs the server (shared expenses, receipts) and it didn't answer.
    case server(WorkspaceProblem)
    /// The change could not be kept on this device.
    case storage(String)
    /// Saving isn't possible in this state (the ledger is still loading, the session changed,
    /// or Undo came too late).
    case unavailable(String)

    public var message: String {
        switch self {
        case .rule(let error): error.message
        case .server(let problem): problem.message
        case .storage(let message), .unavailable(let message): message
        }
    }
}
