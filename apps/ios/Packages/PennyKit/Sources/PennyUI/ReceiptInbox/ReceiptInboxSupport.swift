import Foundation
import PDFKit
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// Text for the receipt inbox screens (MAZ-184, docs/plans/email-receipts.md).
enum InboxText {
    static let offline = "Connect to the internet to attach receipts."
    static let unavailable =
        "This receipt isn't available. It may have been discarded on another device, or it expired."
    static let unverified = "Sender not verified"
    static let returnsToInbox = "The receipt goes back to your inbox."

    /// "12 Nov, 9:41"
    static func received(_ item: WireReceiptInboxItem) -> String {
        Date(milliseconds: item.receivedAt).formatted(date: .abbreviated, time: .shortened)
    }

    static func files(_ count: Int) -> String { count == 1 ? "1 file" : "\(count) files" }

    /// "PDF · 84 KB"
    static func fileDetail(_ file: WireReceiptInboxFile) -> String {
        "\(ReceiptRules.kind(file.mime)) · \(ReceiptRules.formatBytes(file.sizeBytes))"
    }

    /// The row's spoken label: sender, subject, date, file count, and the badge in words.
    static func rowLabel(_ item: WireReceiptInboxItem, attaching: Bool, now: Date) -> String {
        var parts = [
            ReceiptInboxText.sender(item), ReceiptInboxText.subject(item), received(item), files(item.files.count),
        ]
        if !item.senderVerified { parts.append(unverified) }
        if attaching {
            parts.append("Attaching")
        } else if let progress = ReceiptInboxRules.progress(item) {
            parts.append(progress)
        }
        if let expiry = ReceiptInboxRules.expiryNotice(item, now: now) { parts.append(expiry) }
        return parts.joined(separator: ", ")
    }

    /// An entry's line under its title: "$12.80 · Mon, Nov 9 · Flat 4B".
    static func targetDetail(_ target: AttachTarget, currency: String, today: CalendarDate) -> String {
        var parts = [MoneyFormat.amount(target.totalCents, currency: currency)]
        if let date = target.date { parts.append(EntryText.day(date, today: today)) }
        if let household = target.householdName { parts.append(household) }
        if target.hasReceipt { parts.append("Has a receipt") }
        return parts.joined(separator: " · ")
    }

    /// "Attach Email to Coffee at Mill St., 4.50 dollars, 12 November"
    static func attachLabel(_ file: WireReceiptInboxFile, _ target: AttachTarget, currency: String) -> String {
        var parts = [
            "Attach \(ReceiptInboxRules.fileLabel(file)) to \(target.title)",
            MoneyFormat.amount(target.totalCents, currency: currency),
        ]
        if let date = target.date?.foundationDate {
            parts.append(date.formatted(.dateTime.day().month(.wide)))
        }
        return parts.joined(separator: ", ")
    }
}

extension CalendarDate {
    /// Midday on this day in the current time zone (for formatting only).
    var foundationDate: Date? {
        DateComponents(calendar: .current, year: year, month: month, day: day, hour: 12).date
    }
}

/// The ids of inbox items with a file on an entry that waits to sync: the inbox shows those
/// as "Attaching…" until the server has the change.
@MainActor
func attachingInboxItems(_ shell: ShellModel) -> Set<String> {
    guard let ledger = shell.workspace.load.ledger else { return [] }
    let pending = shell.workspace.pendingEntryIDs
    guard !pending.isEmpty else { return [] }
    let receipts = Set(ledger.transactions.filter { pending.contains($0.id) }.compactMap(\.receipt?.id))
    var ids = Set<String>()
    for item in shell.receiptInbox.list(.toAttach)
    where item.files.contains(where: { receipts.contains($0.receiptId) && !$0.linked }) {
        ids.insert(item.id)
    }
    return ids
}

/// The "Sender not verified" badge.
struct UnverifiedBadge: View {
    var body: some View {
        Label(InboxText.unverified, systemImage: "exclamationmark.shield")
            .font(.caption.weight(.semibold))
            .foregroundStyle(PennyColor.pending)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(PennyColor.fill, in: Capsule())
            .accessibilityLabel(InboxText.unverified)
    }
}

/// The first page of an inbox file, downloaded with the session: a PDF's first page or the
/// photo. Decorative for VoiceOver (the file's name and kind carry the meaning); the type's
/// icon stands in while it loads, offline or when it can't be drawn.
struct ReceiptFirstPage: View {
    @Environment(ShellModel.self) private var shell
    let file: WireReceiptInboxFile
    var height: Double = 180
    @State private var image: Image?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(PennyColor.secondarySurface)
            if let image {
                image.resizable().scaledToFit().padding(6)
            } else {
                Image(systemName: ReceiptText.symbol(file.mime))
                    .font(.largeTitle)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PennyColor.separator))
        .accessibilityHidden(true)
        .task(id: file.receiptId) { await load() }
    }

    private func load() async {
        guard let transfers = shell.receipts, transfers.isAvailable,
            let data = try? await transfers.download(id: file.receiptId).data
        else { return }
        let mime = file.mime
        image = await Task.detached { Self.render(data, mime: mime) }.value
    }

    nonisolated static func render(_ data: Data, mime: String) -> Image? {
        #if os(iOS)
            if mime == ReceiptRules.pdf {
                guard let page = PDFDocument(data: data)?.page(at: 0) else { return nil }
                return Image(uiImage: page.thumbnail(of: CGSize(width: 600, height: 800), for: .mediaBox))
            }
            return UIImage(data: data).map {
                Image(uiImage: $0.preparingThumbnail(of: CGSize(width: 600, height: 800)) ?? $0)
            }
        #else
            if mime == ReceiptRules.pdf {
                guard let page = PDFDocument(data: data)?.page(at: 0) else { return nil }
                return Image(nsImage: page.thumbnail(of: CGSize(width: 600, height: 800), for: .mediaBox))
            }
            return NSImage(data: data).map { Image(nsImage: $0) }
        #endif
    }
}

/// One file of an inbox item: its icon, "Email" or its name, the kind and size, and whether it
/// is already on an entry.
struct InboxFileRow: View {
    let file: WireReceiptInboxFile

    var body: some View {
        HStack(spacing: 12) {
            ReceiptThumbnail(mime: file.mime)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: ReceiptInboxRules.fileLabel(file))
                    .font(.headline)
                    .foregroundStyle(PennyColor.label)
                    .lineLimit(2)
                    .truncationMode(.middle)
                Text(verbatim: InboxText.fileDetail(file))
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                if file.linked {
                    Label("Attached", systemImage: "checkmark.circle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.tintText)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The confirmation after attaching: "Receipt attached to Coffee at Mill St." with View entry
/// and Undo. It stays until dismissed (or replaced by the next one).
struct AttachConfirmation: View {
    @Environment(ShellModel.self) private var shell
    @Binding var attachment: ReceiptAttachment?
    @State private var problem: String?
    @State private var undoing = false

    var body: some View {
        if let attachment {
            StatusBanner(tone: .info, title: attachment.message, message: problem) {
                HStack(spacing: 8) {
                    InlineActionButton("View entry") { view(attachment) }
                        .accessibilityIdentifier("receiptInbox.viewEntry")
                    InlineActionButton("Undo") { Task { await undo(attachment) } }
                        .disabled(undoing)
                        .accessibilityIdentifier("receiptInbox.undo")
                    Button("Dismiss", systemImage: "xmark") { self.attachment = nil }
                        .labelStyle(.iconOnly)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("receiptInbox.dismissConfirmation")
                }
            }
            .accessibilityIdentifier("receiptInbox.confirmation")
        }
    }

    private func view(_ attachment: ReceiptAttachment) {
        self.attachment = nil
        switch attachment.target {
        case .personal(let entry): shell.navigate { $0.openEntry(id: entry.id) }
        case .shared(let expense, _):
            shell.navigate { $0.open(.householdExpense(householdID: expense.householdId, expenseID: expense.id)) }
        }
    }

    private func undo(_ attachment: ReceiptAttachment) async {
        guard let attacher = shell.receiptAttacher else { return }
        undoing = true
        defer { undoing = false }
        if let failure = await attacher.undo(attachment) {
            problem = failure
            return
        }
        self.attachment = nil
        await shell.receiptInbox.linksChanged()
    }
}
