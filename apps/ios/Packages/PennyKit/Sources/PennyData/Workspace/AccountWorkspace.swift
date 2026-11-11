import Foundation
public import Observation
public import PennyDomain

/// A signed-in account's ledger for the shell (MAZ-69), backed by the offline ledger and sync
/// engine (MAZ-71). It stores nothing: it reads `LedgerSyncModel` and translates. The model is
/// the app's single instance (created in `LaunchView`, started and told about the scene by
/// `.ledgerSync`); one workspace is made per signed-in shell, and it only shows the model's
/// ledger while the model is on the same account, so nothing of another account appears here.
///
/// Mapping (docs/ios-shell.md, "Sync status"): a session expiry asks for sign-in; a copy that
/// can't be read, is locked or was written by a newer app fails the load with its next step;
/// a sync issue becomes a failing problem; a save error becomes a `SaveFailure`. A failed save
/// changed nothing, so the form keeps its draft.
@MainActor
@Observable
public final class AccountWorkspace: LedgerWorkspace {
    public let scope: AccountScope
    public let isDemo = false

    @ObservationIgnored private let model: LedgerSyncModel
    /// The latest save, for Undo: the ledger right before and right after it.
    @ObservationIgnored private var lastChange: (id: UUID, before: Ledger, after: Ledger)?

    public init(model: LedgerSyncModel, scope: AccountScope) {
        self.model = model
        self.scope = scope
    }

    /// The model's state when it describes this account; nil while it is on no account or on
    /// another one (an account switch, before the new shell replaces this one).
    private var state: LedgerSyncState? { model.state.scope == scope ? model.state : nil }

    public var load: LedgerLoad {
        guard let state else { return .loading }
        return Self.load(state.phase, ledger: model.ledger)
    }

    public var sync: SyncStatus {
        guard let state else { return .syncing(pending: 0) }
        return Self.status(state)
    }

    public var pendingEntryIDs: Set<String> { state?.pending.entryIDs ?? [] }

    // MARK: Actions

    public func commit(_ change: LedgerChange, summary: ChangeSummary) async -> Result<SavedChange, SaveFailure> {
        lastChange = nil
        guard state != nil else { return .failure(Self.failure(.unavailable)) }
        let receipt: SaveReceipt
        do throws(LedgerSaveError) {
            receipt = try await model.save(change)
        } catch {
            return .failure(Self.failure(error))
        }
        // The receipt's before and after are read together by the engine, so their difference
        // is this change plus the recurring entries it made due (a past-dated schedule), and
        // nothing a sync brought in: the inverse puts back only what this save did.
        guard state != nil, receipt.after != receipt.before else {
            return .success(SavedChange(summary: summary, canUndo: false, savedOffline: receipt.savedOffline))
        }
        let saved = SavedChange(summary: summary, canUndo: true, savedOffline: receipt.savedOffline)
        lastChange = (saved.id, receipt.before, receipt.after)
        return .success(saved)
    }

    /// Saves the inverse change (`LedgerChange.revert`) through the model, so the undo is on
    /// disk, pending and synced like any other save. Only the latest change can be undone, and
    /// only while the records it touched are as it left them.
    public func undo(_ change: SavedChange) async -> Result<Void, SaveFailure> {
        guard let last = lastChange, last.id == change.id, state != nil else {
            return .failure(.unavailable(Self.undoTooLate))
        }
        lastChange = nil
        do throws(LedgerSaveError) {
            try await model.save(.revert(last.after, to: last.before))
            return .success(())
        } catch {
            switch error {
            case .rule, .invalid: return .failure(.unavailable(Self.undoTooLate))
            case .notLoaded, .storageUnreadable, .writeFailed, .signingOut, .changingEmail, .unavailable:
                return .failure(Self.failure(error))
            }
        }
    }

    /// The banner's Retry, which does what the load error's action does: download an
    /// unreadable copy again, read a locked one again, otherwise sync now.
    public func syncNow() async { await reload() }

    /// The load error's action: download an unreadable copy again (`recoverUnreadableStorage`),
    /// read a locked one again, otherwise sync now.
    public func reload() async {
        switch state?.phase {
        case .storageUnreadable: await model.recoverUnreadableStorage()
        case .storageUnavailable: model.sceneDidBecomeActive()
        default: model.syncNow()
        }
    }

    // MARK: Mapping

    public static func load(_ phase: LedgerSyncState.Phase, ledger: Ledger?) -> LedgerLoad {
        switch phase {
        case .storageNewerFormat: return .unavailable(Message.newerFormat)
        case .storageUnreadable: return .failed(unreadable)
        default: break
        }
        if let ledger { return .ready(ledger) }
        switch phase {
        case .storageUnavailable: return .failed(locked)
        case .offline, .failed(.offline): return .failed(WorkspaceProblem(.offline, Message.downloadOffline))
        case .failed(let issue): return .failed(problem(issue))
        case .sessionExpired: return .failed(WorkspaceProblem(.sessionExpired, Message.downloadSignIn))
        case .signedOut, .loading, .upToDate, .syncing, .pending, .storageUnreadable, .storageNewerFormat:
            return .loading
        }
    }

    public static func status(_ state: LedgerSyncState) -> SyncStatus {
        let pending = state.pending.count
        switch state.phase {
        case .upToDate, .signedOut: return .upToDate(lastSynced: state.lastSyncedAt)
        case .loading, .syncing, .pending: return .syncing(pending: pending)
        case .offline, .failed(.offline): return .offline(pending: pending, lastSynced: state.lastSyncedAt)
        case .failed(let issue): return .failing(pending: pending, problem: problem(issue))
        case .sessionExpired: return .signInRequired(pending: pending)
        case .storageUnavailable: return .failing(pending: pending, problem: locked)
        case .storageUnreadable: return .failing(pending: pending, problem: unreadable)
        case .storageNewerFormat:
            return .failing(pending: pending, problem: WorkspaceProblem(.storage, Message.newerFormatSync))
        }
    }

    public static func problem(_ issue: SyncIssue) -> WorkspaceProblem {
        switch issue {
        case .offline: WorkspaceProblem(.offline, Message.offline)
        case .serverUnreachable: WorkspaceProblem(.unreachable, Message.unreachable)
        case .serverUnavailable: WorkspaceProblem(.server, Message.serverUnavailable)
        case .rejected(let message?): WorkspaceProblem(.server, "\(Message.sentence(message)) \(Message.keptOnDevice)")
        case .rejected(nil): WorkspaceProblem(.server, Message.rejected)
        case .conflictRetriesExhausted: WorkspaceProblem(.conflict, Message.conflict)
        case .incompatibleServerData: WorkspaceProblem(.server, Message.incompatible)
        case .storageWriteFailed: WorkspaceProblem(.storage, Message.storageWriteFailed)
        }
    }

    /// `SaveFailure.server` is not produced here: it is for online-only actions (shared
    /// expenses, receipts), which never go through the offline ledger.
    public static func failure(_ error: LedgerSaveError) -> SaveFailure {
        switch error {
        case .rule(let rule): .rule(rule)
        case .invalid, .notLoaded, .signingOut, .changingEmail, .unavailable: .unavailable(error.message)
        case .storageUnreadable, .writeFailed: .storage(error.message)
        }
    }

    static let unreadable = WorkspaceProblem(.storageUnreadable, Message.unreadable)
    static let locked = WorkspaceProblem(.storage, Message.locked)
    /// Undo came too late: not the latest change, or what it touched changed since.
    public static let undoTooLate = Message.undoTooLate

    enum Message {
        static let keptOnDevice = "Your changes are kept on this device."
        static let offline = "Your changes are saved on this device and sync when you're back online."
        static let unreachable = "Penny couldn't reach your server. Your changes are kept and Penny will try again."
        static let serverUnavailable =
            "Your server isn't available right now. Your changes are kept and Penny will try again."
        static let rejected = "Your server refused these changes. They're kept on this device; tap Retry to try again."
        static let conflict =
            "Your ledger is changing on another device. Your changes are kept and Penny will try again."
        static let incompatible = "Your server has entries this version of Penny can't read. Update Penny to sync."
        static let storageWriteFailed = "This device couldn't record the sync. Free some space; Penny will try again."
        static let unreadable =
            "Your entries on this device can't be read. Download them again; the unreadable copy is set aside."
        static let locked = "Your entries stay locked until this device is unlocked. Unlock it, then try again."
        static let newerFormat =
            "Your entries on this device were saved by a newer version of Penny. Update Penny to open them."
        static let newerFormatSync = "Update Penny to sync the entries on this device."
        static let downloadOffline = "Connect to the internet to download your entries."
        static let downloadSignIn = "Sign in again to download your entries."
        static let undoTooLate = "This change can't be undone anymore: it changed since, here or on another device."

        /// A server message as a sentence, so the next one can follow it.
        static func sentence(_ text: String) -> String {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let last = trimmed.last else { return trimmed }
            return ".!?".contains(last) ? trimmed : trimmed + "."
        }
    }
}
