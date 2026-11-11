public import Foundation
public import PennyDomain

/// Kept entry drafts on disk, per account (MAZ-141): "Keep as draft" and a sheet replaced by a
/// deep link survive the app quitting. The file sits next to the account's ledger under the
/// same name, so removing the account's data (`LedgerFileStore.remove(_:)`, sign-out) removes
/// its drafts too, and it is written the same durable way. It is not a `.json` file, so
/// `storedScopes()` never reads it as a ledger.
extension LedgerFileStore {
    public func draftsURL(for scope: AccountScope) -> URL {
        directory.appendingPathComponent("\(fileName(for: scope)).drafts")
    }

    /// The account's kept drafts; empty when there are none or the file can't be read (a
    /// draft is a convenience: an unreadable one is dropped, never a reason to block).
    public func loadDrafts(_ scope: AccountScope) -> EntryDraftShelf {
        guard let data = try? fileSystem.read(draftsURL(for: scope)),
            let stored = try? JSONDecoder().decode(StoredDrafts.self, from: data),
            stored.version == StoredDrafts.current
        else { return EntryDraftShelf() }
        return EntryDraftShelf(kept: stored.drafts.compactMap(\.editor))
    }

    /// Replaces the account's kept drafts; an empty shelf removes the file.
    public func saveDrafts(_ shelf: EntryDraftShelf, for scope: AccountScope) throws(LedgerStoreError) {
        do {
            let kept = shelf.kept
            guard !kept.isEmpty else {
                try fileSystem.remove(draftsURL(for: scope))
                return
            }
            let data = try JSONEncoder().encode(StoredDrafts(drafts: kept.map(StoredEditor.init)))
            try fileSystem.write(data, to: draftsURL(for: scope))
        } catch {
            throw .writeFailed
        }
    }
}

struct StoredDrafts: Codable {
    static let current = 1
    var version = current
    var drafts: [StoredEditor]
}

struct StoredEditor: Codable {
    /// The entry being edited, in the ledger's wire form; nil for a new entry.
    var editing: WireEntry?
    var draft: StoredDraft

    init(_ editor: EntryEditor) {
        editing = editor.original.flatMap { WireLedger(Ledger(transactions: [$0])).transactions.first }
        draft = StoredDraft(editor.draft)
    }

    var editor: EntryEditor? {
        guard let draft = draft.value else { return nil }
        guard let editing else { return EntryEditor(restoring: draft, mode: .new) }
        var wire = WireLedger(Ledger())
        wire.transactions = [editing]
        guard let entry = (try? Ledger(wire: wire))?.transactions.first else { return nil }
        return EntryEditor(restoring: draft, mode: .edit(entry))
    }
}

struct StoredDraft: Codable {
    var kind: String
    var title: String
    var amount: String
    var date: String
    var categoryId: String
    var accountId: String?
    var tripId: String?
    var note: String
    var split: String
    var shareInput: String
    var frequency: String?
    var receipt: WireReceipt?

    init(_ draft: EntryDraft) {
        kind = draft.kind.rawValue
        title = draft.title
        amount = draft.amount
        date = draft.date
        categoryId = draft.categoryId
        accountId = draft.accountId
        tripId = draft.tripId
        note = draft.note
        split = draft.split.rawValue
        shareInput = draft.shareInput
        frequency = draft.frequency?.rawValue
        receipt = draft.receipt.map { WireReceipt(id: $0.id, name: $0.name, mime: $0.mime, uri: $0.uri) }
    }

    /// The draft, or nil when a value is not one this build knows.
    var value: EntryDraft? {
        guard let kind = EntryKind(rawValue: kind), let split = Money.SplitMode(rawValue: split) else { return nil }
        var repeats: RecurrenceFrequency?
        if let frequency {
            guard let known = RecurrenceFrequency(rawValue: frequency) else { return nil }
            repeats = known
        }
        return EntryDraft(
            kind: kind, title: title, amount: amount, date: date, categoryId: categoryId, accountId: accountId,
            tripId: tripId, note: note, split: split, shareInput: shareInput, frequency: repeats,
            receipt: receipt.map { ReceiptReference(id: $0.id, name: $0.name, uri: $0.uri, mime: $0.mime) })
    }
}
