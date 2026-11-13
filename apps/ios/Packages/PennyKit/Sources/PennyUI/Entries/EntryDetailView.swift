import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// `entry-detail`: one personal entry with its amount (your share), details, split and
/// receipt, and Edit and Delete in the toolbar. Delete always asks first.
struct EntryDetailView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let id: String
    /// After a delete: shown beside the iPad Activity list, the selection clears; pushed, the
    /// page closes (the default).
    var onDeleted: (() -> Void)?
    @State private var deleting: LedgerEntry?
    @State private var previewing: ReceiptPreviewRequest?

    var body: some View {
        WorkspaceContent { ledger in
            if let entry = ledger.entry(id: id) {
                content(entry, ledger: ledger)
            } else {
                PennyStateView(
                    .empty, title: "This entry is gone",
                    message: "It was deleted here or on another device.")
            }
        }
        .background(PennyColor.background)
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.entryDetail")
    }

    private func content(_ entry: LedgerEntry, ledger: Ledger) -> some View {
        let category = ledger.category(id: entry.categoryId)
        let currency = ledger.currency.rawValue
        let waiting = shell.workspace.pendingEntryIDs.contains(entry.id)
        return List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    CategoryIcon(
                        symbol: EntryText.symbol(category), color: EntryText.color(category, id: entry.categoryId),
                        size: 52)
                    Text(entry.title).font(.title.weight(.bold)).foregroundStyle(PennyColor.label)
                    Text("\(category?.name ?? "No category") · \(DayText.long(entry.date, today: shell.today))")
                        .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    Text(MoneyFormat.signed(entry.share, meaning: EntryText.meaning(entry.kind), currency: currency))
                        .modifier(HeroAmountFont())
                        .foregroundStyle(EntryText.meaning(entry.kind).color)
                        .lineLimit(1)
                        .minimumScaleFactor(0.4)
                        .accessibilityLabel(
                            MoneyFormat.spoken(entry.share, meaning: EntryText.meaning(entry.kind), currency: currency))
                    if entry.share != entry.total {
                        Text("Your share of \(MoneyFormat.amount(entry.total, currency: currency))")
                            .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    if waiting {
                        Label("Waiting to sync", systemImage: "clock")
                            .font(.footnote).foregroundStyle(PennyColor.pending)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                .accessibilityElement(children: .combine)
            }
            Section("Details") {
                detail("Account", entry.accountId.flatMap(ledger.account(id:))?.name)
                detail(
                    "Repeats",
                    entry.recurringId.flatMap(ledger.rule(id:)).map { EntryText.frequency($0.frequency) } ?? "Never")
                if entry.kind == .expense { detail("Trip", entry.tripId.flatMap(ledger.trip(id:))?.name) }
                detail("Note", entry.note.isEmpty ? nil : entry.note)
            }
            if entry.kind == .expense, entry.share != entry.total || entry.receipt != nil {
                Section("Split and receipt") {
                    if entry.share != entry.total {
                        detail("Your share", MoneyFormat.amount(entry.share, currency: currency))
                        detail("Total", MoneyFormat.amount(entry.total, currency: currency))
                    }
                    if let receipt = entry.receipt {
                        Button {
                            previewing = ReceiptPreviewRequest(receipt: receipt)
                        } label: {
                            HStack(spacing: 12) {
                                ReceiptThumbnail(mime: receipt.mime)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(receipt.name).foregroundStyle(PennyColor.label).lineLimit(2)
                                        .truncationMode(.middle)
                                    Text(ReceiptRules.kind(receipt.mime)).font(.subheadline)
                                        .foregroundStyle(PennyColor.secondaryLabel)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                                    .foregroundStyle(PennyColor.tertiaryLabel).accessibilityHidden(true)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityHint("Opens the receipt")
                        .accessibilityIdentifier("entryDetail.receipt")
                    }
                }
            }
        }
        .insetGroupedList()
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = entry }
                    .tint(PennyColor.danger)
                    .accessibilityIdentifier("entryDetail.delete")
                Button("Edit", systemImage: "square.and.pencil") { shell.edit(entry) }
                    .accessibilityIdentifier("entryDetail.edit")
            }
        }
        .receiptViewer($previewing) { request in
            ReceiptPreviewView(
                receipt: request.receipt, transfers: shell.receipts,
                context: ReceiptPreviewContext(
                    title: entry.title,
                    detail:
                        "\(MoneyFormat.amount(entry.total, currency: currency)) total · \(EntryText.day(entry.date, today: shell.today))",
                    symbol: EntryText.symbol(category), color: EntryText.color(category, id: entry.categoryId)))
        }
        .deleteEntryConfirmation($deleting) {
            if let onDeleted { onDeleted() } else { dismiss() }
        }
    }

    private func detail(_ title: String, _ value: String?) -> some View {
        HStack {
            Text(title).foregroundStyle(PennyColor.secondaryLabel)
            Spacer()
            Text(value ?? "None")
                .foregroundStyle(value == nil ? PennyColor.tertiaryLabel : PennyColor.label)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}
