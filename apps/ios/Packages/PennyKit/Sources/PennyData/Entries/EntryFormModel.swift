import Foundation
public import Observation
public import PennyDomain

/// The entry form's save flow (MAZ-73) over any `LedgerWorkspace`: build the change from the
/// draft (`EntryEditor`), commit it once, and keep the draft on failure.
///
/// `commit` is the shell's commit (toast, Undo and haptics on success); it returns the failure
/// or nil. A second Save while one runs, or after one succeeded, does nothing. A stale edit
/// (the entry changed on another device) is refused by the ledger rules and reported with
/// `EntryEditor.hasConflict`; `reviewLatest(in:)` reopens the form on the latest version.
@MainActor
@Observable
public final class EntryFormModel {
    public var editor: EntryEditor
    /// Bumped when the draft is refused before saving (invalid amount, missing title...), for
    /// the error haptic. A failed commit is reported by the shell, which has its own haptic.
    public private(set) var refusedCount = 0

    @ObservationIgnored private let commit: @MainActor (LedgerChange, ChangeSummary) async -> SaveFailure?
    @ObservationIgnored private let makeID: () -> String

    public init(
        editor: EntryEditor, commit: @escaping @MainActor (LedgerChange, ChangeSummary) async -> SaveFailure?,
        makeID: (() -> String)? = nil
    ) {
        self.editor = editor
        self.commit = commit
        self.makeID = makeID ?? { UUID().uuidString.lowercased() }
    }

    public var draft: EntryDraft {
        get { editor.draft }
        set { editor.draft = newValue }
    }

    /// Saves the draft to `ledger`'s workspace. Returns true once it is kept (the form can
    /// close); false when it was refused, failed, or a save was already running.
    @discardableResult
    public func save(in ledger: Ledger, summary: (LedgerEntry, _ isNew: Bool) -> ChangeSummary) async -> Bool {
        let isNew = editor.isNew
        switch editor.beginSave(in: ledger, makeID: makeID) {
        case .alreadySaving:
            return false
        case .invalid:
            refusedCount += 1
            return false
        case .ready(let attempt):
            let failure = await commit(attempt.change, summary(attempt.entry, isNew))
            editor.finish(attempt.number, failure: failure.map(Self.failure))
            return failure == nil
        }
    }

    /// After a conflict: reopens the form on the entry as `ledger` holds it now. False when it
    /// was deleted on another device, so the form should close.
    public func reviewLatest(in ledger: Ledger) -> Bool {
        guard let original = editor.original else { return false }
        return editor.reviewLatest(ledger.entry(id: original.id))
    }

    public static func failure(_ failure: SaveFailure) -> EntrySaveFailure {
        if case .rule(let rule) = failure { return EntrySaveFailure(rule: rule) }
        return EntrySaveFailure(message: failure.message)
    }
}
