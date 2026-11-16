public import Foundation
public import PennyDomain

// The rules of the receipt inbox and the attach sheet (MAZ-184,
// docs/plans/email-receipts.md "UX guidelines: attaching an emailed receipt"). Pure values, so
// every rule is tested without a server or a view.

/// An entry an emailed receipt can be attached to: a personal expense, or a shared expense of a
/// household the person is a current member of.
public enum AttachTarget: Equatable, Sendable, Identifiable {
    case personal(LedgerEntry)
    case shared(WireSharedExpense, householdName: String)

    public var id: String {
        switch self {
        case .personal(let entry): "entry \(entry.id)"
        case .shared(let expense, _): "shared \(expense.householdId) \(expense.id)"
        }
    }

    public var title: String {
        switch self {
        case .personal(let entry): entry.title
        case .shared(let expense, _): expense.title
        }
    }

    /// The whole amount in cents.
    public var totalCents: Int64 {
        switch self {
        case .personal(let entry): entry.total
        case .shared(let expense, _): expense.totalCents
        }
    }

    public var date: PennyDomain.CalendarDate? {
        switch self {
        case .personal(let entry): entry.date
        case .shared(let expense, _): expense.calendarDate
        }
    }

    /// Only expenses take a receipt; shared expenses always are.
    public var isExpense: Bool {
        switch self {
        case .personal(let entry): entry.kind == .expense
        case .shared: true
        }
    }

    public var receiptId: String? {
        switch self {
        case .personal(let entry): entry.receipt?.id
        case .shared(let expense, _): expense.receiptId ?? expense.receipt?.id
        }
    }

    /// The current receipt's name, for "This replaces …".
    public var receiptName: String? {
        switch self {
        case .personal(let entry): entry.receipt?.name
        case .shared(let expense, _): expense.receipt?.name ?? (expense.receiptId == nil ? nil : "the current receipt")
        }
    }

    public var hasReceipt: Bool { receiptId != nil }

    /// The household that will see the receipt; nil for a personal entry.
    public var householdName: String? {
        if case .shared(_, let name) = self { return name }
        return nil
    }
}

public enum ReceiptInboxRules {
    /// Suggestions look this many days either side of the received date.
    public static let suggestionWindowDays = 7
    public static let suggestionLimit = 5
    /// Unhandled items say when they will be deleted for their last days.
    public static let expiryNoticeDays = 3

    /// The calendar day the email arrived, in the person's time zone.
    public static func receivedDay(_ receivedAt: Int64, in calendar: Calendar = .current) -> PennyDomain.CalendarDate {
        PennyDomain.CalendarDate(Date(milliseconds: receivedAt), in: calendar)
    }

    /// Expenses without a receipt dated up to 7 days either side of `received`, nearest date
    /// first (the later one first on a tie, then by title), at most 5. Income, investments and
    /// expenses that already have a receipt are never suggested.
    public static func suggestions(
        _ targets: [AttachTarget], received: PennyDomain.CalendarDate, limit: Int = suggestionLimit
    ) -> [AttachTarget] {
        let candidates: [(AttachTarget, PennyDomain.CalendarDate, Int)] = targets.compactMap { target in
            guard target.isExpense, !target.hasReceipt, let date = target.date else { return nil }
            let distance = abs(date.days(since: received))
            guard distance <= suggestionWindowDays else { return nil }
            return (target, date, distance)
        }
        let sorted = candidates.sorted { lhs, rhs in
            if lhs.2 != rhs.2 { return lhs.2 < rhs.2 }
            if lhs.1 != rhs.1 { return lhs.1 > rhs.1 }
            if lhs.0.title != rhs.0.title { return lhs.0.title < rhs.0.title }
            return lhs.0.id < rhs.0.id
        }
        return Array(sorted.prefix(max(0, limit)).map(\.0))
    }

    /// Search over every expense (with or without a receipt): title or note containing every
    /// word of `query`, ignoring case and accents, newest first.
    public static func search(_ targets: [AttachTarget], query: String) -> [AttachTarget] {
        let words = query.split(whereSeparator: \.isWhitespace).map { fold(String($0)) }
        guard !words.isEmpty else { return [] }
        return
            targets
            .filter { target in
                guard target.isExpense else { return false }
                let text = fold("\(target.title) \(note(target)) \(target.householdName ?? "")")
                return words.allSatisfy { text.contains($0) }
            }
            .sorted { ($0.date ?? .earliest) > ($1.date ?? .earliest) }
    }

    private static func note(_ target: AttachTarget) -> String {
        switch target {
        case .personal(let entry): entry.note
        case .shared(let expense, _): expense.note
        }
    }

    private static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    /// The personal expenses of `ledger` an emailed receipt may go to.
    public static func personalTargets(_ ledger: Ledger) -> [AttachTarget] {
        ledger.transactions.filter { $0.kind == .expense }.map(AttachTarget.personal)
    }

    /// The file the attach sheet preselects: the first attachment (a merchant's invoice is
    /// usually the real receipt), otherwise the rendered email.
    public static func preselectedFile(_ item: WireReceiptInboxItem) -> WireReceiptInboxFile? {
        orderedFiles(item).first { $0.kind == "attachment" } ?? orderedFiles(item).first
    }

    /// The rendered email first, then the attachments in the server's order.
    public static func orderedFiles(_ item: WireReceiptInboxItem) -> [WireReceiptInboxFile] {
        item.files.filter { $0.kind == "email" } + item.files.filter { $0.kind != "email" }
    }

    /// The files that can still be attached: the unlinked ones, preselection first.
    public static func attachableFiles(_ item: WireReceiptInboxItem) -> [WireReceiptInboxFile] {
        orderedFiles(item).filter { !$0.linked }
    }

    /// "Deleted in 3 days" for an unhandled item's last 3 days; nil before that or once attached.
    public static func expiryNotice(_ item: WireReceiptInboxItem, now: Date) -> String? {
        guard item.status != "attached", let expiresAt = item.expiresAt else { return nil }
        let remaining = Date(milliseconds: expiresAt).timeIntervalSince(now)
        let days = Int((remaining / 86_400).rounded(.up))
        guard days <= expiryNoticeDays else { return nil }
        if days <= 0 { return "Deleted today" }
        return days == 1 ? "Deleted in 1 day" : "Deleted in \(days) days"
    }

    /// "1 of 2 attached" for a partly attached item.
    public static func progress(_ item: WireReceiptInboxItem) -> String? {
        guard item.status == "partly_attached" else { return nil }
        return "\(item.files.filter(\.linked).count) of \(item.files.count) attached"
    }

    /// The Discard confirmation. Linked files are never deleted, and it says how many stay.
    public static func discardMessage(_ item: WireReceiptInboxItem) -> String {
        let deleted = item.files.filter { !$0.linked }.count
        let kept = item.files.count - deleted
        var text =
            deleted == 1
            ? "Discard this email? Its file will be deleted. This can't be undone."
            : "Discard this email? Its \(deleted) files will be deleted. This can't be undone."
        if kept > 0 {
            text += kept == 1 ? " 1 file attached to an entry is kept." : " \(kept) files attached to entries are kept."
        }
        return text
    }

    /// The Done confirmation (a partly attached item): the unlinked files go.
    public static func doneMessage(_ item: WireReceiptInboxItem) -> String {
        let deleted = item.files.filter { !$0.linked }.count
        let files = deleted == 1 ? "file that isn't attached" : "\(deleted) files that aren't attached"
        return "Mark this email as done? The \(files) will be deleted. This can't be undone."
    }

    /// The spoken inbox count: "3 receipts to attach".
    public static func spokenCount(_ count: Int) -> String {
        count == 1 ? "1 receipt to attach" : "\(count) receipts to attach"
    }

    /// What the receipt's name is called in the attach sheet: "Email" for the rendered message.
    public static func fileLabel(_ file: WireReceiptInboxFile) -> String {
        file.kind == "email" ? "Email" : ReceiptInboxText.plain(file.name)
    }

    /// The receipt as an entry links it, for the ledger or the entry form.
    public static func reference(_ file: WireReceiptInboxFile) -> ReceiptReference {
        ReceiptReference(
            id: file.receiptId, name: ReceiptInboxText.plain(file.name, maxLength: ReceiptRules.maxNameLength),
            uri: file.uri, mime: file.mime)
    }

    /// The personal entry with `file` attached (replacing any receipt it had).
    public static func attaching(_ file: WireReceiptInboxFile, to entry: LedgerEntry) -> LedgerEntry {
        var next = entry
        next.receipt = reference(file)
        return next
    }

    /// The update body that links `receiptId` to a shared expense (nil unlinks), keeping every
    /// other value. A percentage split is sent as the exact shares the server stored, as the
    /// edit form does, because the server keeps shares rather than percentages.
    public static func sharedUpdate(_ expense: WireSharedExpense, receiptId: String?, timezoneOffset: Int)
        -> WireExpenseInput
    {
        let mode = expense.mode
        let allocations: [WireAllocation]? =
            mode == .equal
            ? nil : expense.splits.sorted { $0.userId < $1.userId }.map { .amount($0.userId, $0.amountCents) }
        return WireExpenseInput(
            title: expense.title, totalCents: expense.totalCents, date: expense.date, payerUserId: expense.payerUserId,
            splitMode: mode == .equal ? SharedSplitMode.equal.rawValue : SharedSplitMode.exact.rawValue,
            allocations: allocations, category: expense.category, note: expense.note, accountId: expense.accountId,
            receiptId: receiptId, timezoneOffsetMinutes: timezoneOffset, revision: expense.revision)
    }
}

/// Untrusted text from an email (sender, subject, file names): control, format and bidi
/// characters removed and whitespace runs collapsed to one space, so a header can't break a
/// line, reorder what follows or hide text. The result is shown with `Text(verbatim:)`: never
/// as Markdown or HTML.
public enum ReceiptInboxText {
    public static func plain(_ text: String, maxLength: Int = 500) -> String {
        var scalars = String.UnicodeScalarView()
        var lastWasSpace = false
        for scalar in text.unicodeScalars {
            let category = scalar.properties.generalCategory
            if scalar.properties.isWhitespace || category == .lineSeparator || category == .paragraphSeparator {
                if !lastWasSpace, !scalars.isEmpty { scalars.append(" ") }
                lastWasSpace = true
                continue
            }
            switch category {
            case .control, .format, .privateUse, .surrogate, .unassigned: continue
            default: break
            }
            scalars.append(scalar)
            lastWasSpace = false
        }
        var result = String(scalars).trimmingCharacters(in: .whitespaces)
        if result.utf16.count > maxLength {
            result = String(result.prefix(maxLength))
            while result.utf16.count > maxLength { result.removeLast() }
        }
        return result
    }

    /// The sender as a row and a new expense's title show it ("Unknown sender" when empty).
    public static func sender(_ item: WireReceiptInboxItem) -> String {
        let text = plain(item.from, maxLength: 200)
        return text.isEmpty ? "Unknown sender" : text
    }

    public static func subject(_ item: WireReceiptInboxItem) -> String {
        let text = plain(item.subject)
        return text.isEmpty ? "No subject" : text
    }
}
