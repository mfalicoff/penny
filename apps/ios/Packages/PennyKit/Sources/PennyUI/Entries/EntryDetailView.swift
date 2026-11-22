import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// `entry-detail`: one personal entry with its amount (your share), details, split and
/// receipt, and Delete and a labelled Edit in the toolbar. Delete always asks first.
///
/// On iPhone (`iphone-entry-detail`) the header, Details and Split & receipt stack, with the
/// receipt beside the split. In a regular width (`ipad-activity`) the icon sits beside the title,
/// "your share of" beside the amount, and Details and Split are two cards side by side. A glow in
/// the entry's color sits behind the header on both.
struct EntryDetailView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    let id: String
    /// After a delete: shown beside the iPad Activity list, the selection clears; pushed, the
    /// page closes (the default).
    var onDeleted: (() -> Void)?
    /// Beside the iPad Activity list: the copper Add entry capsule follows Edit, at the
    /// trailing end of the toolbar (`ipad-activity` card, MAZ-254).
    var showsAddEntry = false
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

    private var regular: Bool { sizeClass == .regular }

    private func content(_ entry: LedgerEntry, ledger: Ledger) -> some View {
        let category = ledger.category(id: entry.categoryId)
        let currency = ledger.currency.rawValue
        let color = EntryText.tileColor(entry.kind, category: category, id: entry.categoryId)
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header(entry, category: category, color: color, currency: currency)
                    .padding(.horizontal, regular ? 0 : 8)
                if regular {
                    HStack(alignment: .top, spacing: 16) {
                        detailsPanel(entry, ledger: ledger)
                        if EntryDetailText.hasSplitOrReceipt(entry) {
                            splitPanel(entry, currency: currency)
                        } else {
                            Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
                        }
                    }
                    .padding(.top, 24)
                } else {
                    groupLabel("Details")
                    detailRows(entry, ledger: ledger)
                        .background(PennyColor.surface, in: cardShape)
                    if EntryDetailText.hasSplitOrReceipt(entry) {
                        groupLabel(
                            entry.share != entry.total && entry.receipt != nil
                                ? "Split & receipt" : entry.receipt != nil ? "Receipt" : "Split")
                        splitAndReceipt(entry, currency: currency)
                    }
                }
            }
            .padding(.horizontal, regular ? 24 : 16)
            .padding(.top, regular ? 8 : 34)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, alignment: .leading)
            .heroGlow(top: regular ? -200 : -120, tint: color)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = entry }
                    .tint(PennyColor.danger)
                    .accessibilityIdentifier("entryDetail.delete")
            }
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) {
                // The card's labelled "Edit" capsule, in the label color: copper stays for the
                // screen's one primary action.
                Button {
                    shell.edit(entry)
                } label: {
                    // An HStack, not a Label: the toolbar draws a Label icon-only.
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.pencil")
                        Text("Edit")
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(PennyColor.label)
                }
                .tint(PennyColor.label)
                .accessibilityLabel("Edit")
                .accessibilityIdentifier("entryDetail.edit")
            }
            if showsAddEntry {
                ToolbarSpacer(.fixed, placement: .primaryAction)
                ToolbarItem(placement: .primaryAction) {
                    AddEntryCapsule().accessibilityIdentifier("activity.add")
                }
            }
        }
        .receiptViewer($previewing) { request in
            ReceiptPreviewView(
                receipt: request.receipt, transfers: shell.receipts,
                context: ReceiptPreviewContext(
                    title: entry.title,
                    detail:
                        "\(MoneyFormat.amount(entry.total, currency: currency)) total · \(EntryText.day(entry.date, today: shell.today))",
                    symbol: EntryText.tileSymbol(entry.kind, category: category),
                    color: color))
        }
        .deleteEntryConfirmation($deleting) {
            if let onDeleted { onDeleted() } else { dismiss() }
        }
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
    }

    // MARK: Header

    @ViewBuilder
    private func header(_ entry: LedgerEntry, category: LedgerCategory?, color: Color, currency: String)
        -> some View
    {
        let waiting = shell.workspace.pendingEntryIDs.contains(entry.id)
        let meaning = EntryText.meaning(entry.kind)
        let icon = CategoryIcon(
            symbol: EntryText.tileSymbol(entry.kind, category: category), color: color, size: 52)
        let title = Text(entry.title).font(.title.weight(.bold)).foregroundStyle(PennyColor.label)
        let meta = Text("\(category?.name ?? "No category") · \(EntryDetailText.day(entry.date, today: shell.today))")
            .font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
        let amount = Text(MoneyFormat.signed(entry.share, meaning: meaning, currency: currency))
            .modifier(HeroAmountFont())
            .foregroundStyle(meaning.color)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
            .accessibilityLabel(MoneyFormat.spoken(entry.share, meaning: meaning, currency: currency))
        let shareOf = entry.share != entry.total ? MoneyFormat.amount(entry.total, currency: currency) : nil
        VStack(alignment: .leading, spacing: 0) {
            if regular {
                HStack(spacing: 14) {
                    icon
                    VStack(alignment: .leading, spacing: 2) {
                        title
                        meta
                    }
                }
                // Beside the amount, as on the card: the amount scales down before the line wraps.
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    amount
                    if let shareOf {
                        shareOfText("your share of \(shareOf)", regular: true)
                            .lineLimit(2)
                            .layoutPriority(1)
                    }
                }
                .padding(.top, 22)
            } else {
                icon
                title.padding(.top, 14)
                meta.padding(.top, 2)
                amount.padding(.top, 16)
                if let shareOf { shareOfText("Your share of \(shareOf)", regular: false).padding(.top, 8) }
            }
            if waiting {
                Label("Waiting to sync", systemImage: "clock")
                    .font(.footnote).foregroundStyle(PennyColor.pending)
                    .padding(.top, 8)
            }
        }
        .padding(.top, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func shareOfText(_ text: String, regular: Bool) -> some View {
        Text(text)
            .font(regular ? .title3.weight(.medium) : .subheadline.weight(.medium))
            .foregroundStyle(PennyColor.secondaryLabel)
    }

    // MARK: iPhone groups

    /// A small upper-case label over a group, as the cards' DETAILS and SPLIT & RECEIPT.
    private func groupLabel(_ title: String) -> some View {
        Text(title)
            .cardSectionHeader()
            .padding(.leading, 16)
            .padding(.top, 22)
            .padding(.bottom, 6)
            .accessibilityLabel(title)
            .accessibilityAddTraits(.isHeader)
    }

    /// Account, Repeats, Trip (expenses only) and Note; nil values read "None".
    private func detailItems(_ entry: LedgerEntry, ledger: Ledger) -> [(String, String?)] {
        var items: [(String, String?)] = [
            ("Account", entry.accountId.flatMap(ledger.account(id:))?.name),
            (
                "Repeats",
                entry.recurringId.flatMap(ledger.rule(id:)).map { EntryText.frequency($0.frequency) } ?? "Never"
            ),
        ]
        if entry.kind == .expense { items.append(("Trip", entry.tripId.flatMap(ledger.trip(id:))?.name)) }
        items.append(("Note", entry.note.isEmpty ? nil : entry.note))
        return items
    }

    private func detailRows(_ entry: LedgerEntry, ledger: Ledger) -> some View {
        rows(detailItems(entry, ledger: ledger), inset: 16)
    }

    /// Split, Your share and Total, with the receipt's thumbnail beside them (`iphone-entry-detail`).
    @ViewBuilder
    private func splitAndReceipt(_ entry: LedgerEntry, currency: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            if let split = EntryDetailText.split(entry) {
                rows(
                    [
                        ("Split", split.method),
                        ("Your share", MoneyFormat.amount(entry.share, currency: currency)),
                        ("Total", MoneyFormat.amount(entry.total, currency: currency)),
                    ], inset: 16
                )
                .background(PennyColor.surface, in: cardShape)
            }
            if let receipt = entry.receipt {
                receiptTile(receipt)
                    .frame(width: 112)
            }
        }
    }

    // MARK: Regular-width panels

    private func detailsPanel(_ entry: LedgerEntry, ledger: Ledger) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            panelTitle("Details", detail: nil)
            rows(detailItems(entry, ledger: ledger), inset: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PennyColor.surface, in: cardShape)
    }

    /// "Split · Equally · 2 people", your share and the other people's, then the receipt
    /// (`ipad-activity`).
    private func splitPanel(_ entry: LedgerEntry, currency: String) -> some View {
        let split = EntryDetailText.split(entry)
        return VStack(alignment: .leading, spacing: 8) {
            panelTitle(split == nil ? "Receipt" : "Split", detail: split?.method)
            if let split {
                VStack(spacing: 0) {
                    shareRow(
                        "Your share", symbol: "checkmark", amount: MoneyFormat.amount(entry.share, currency: currency),
                        secondary: false)
                    shareRow(
                        EntryDetailText.others(split), symbol: "person.2",
                        amount: MoneyFormat.amount(entry.total - entry.share, currency: currency), secondary: true)
                }
            }
            if let receipt = entry.receipt {
                receiptBanner(receipt).padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PennyColor.surface, in: cardShape)
    }

    private func panelTitle(_ title: String, detail: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.headline.weight(.bold)).foregroundStyle(PennyColor.label)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            if let detail {
                Text(detail).font(.subheadline.weight(.medium)).foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.trailing)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func shareRow(_ title: String, symbol: String, amount: String, secondary: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(secondary ? PennyColor.secondaryLabel : PennyColor.label)
                .frame(width: 30, height: 30)
                .background(PennyColor.fill, in: Circle())
                .accessibilityHidden(true)
            Text(title).foregroundStyle(PennyColor.label)
            Spacer(minLength: 8)
            Text(amount).fontWeight(.semibold).monospacedDigit().fixedSize()
                .foregroundStyle(secondary ? PennyColor.secondaryLabel : PennyColor.label)
        }
        .font(.subheadline)
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }

    // MARK: Rows and receipt

    /// Label-and-value rows with separators between them, as the cards' `.kv`.
    private func rows(_ items: [(String, String?)], inset: CGFloat) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Rectangle().fill(PennyColor.separator).frame(height: 0.5).padding(.leading, inset)
                }
                HStack(alignment: .firstTextBaseline) {
                    Text(item.0).foregroundStyle(PennyColor.secondaryLabel)
                    Spacer(minLength: 12)
                    Text(item.1 ?? "None")
                        .fontWeight(.medium)
                        .foregroundStyle(item.1 == nil ? PennyColor.tertiaryLabel : PennyColor.label)
                        .multilineTextAlignment(.trailing)
                }
                .padding(.horizontal, inset)
                .frame(minHeight: regular ? 46 : 48)
                .accessibilityElement(children: .combine)
            }
        }
        .font(regular ? .subheadline : .body)
    }

    /// The receipt beside the split on iPhone: a sheet of paper over its name.
    private func receiptTile(_ receipt: ReceiptReference) -> some View {
        receiptButton(receipt) {
            VStack(spacing: 6) {
                ReceiptPaper(pdf: receipt.mime == ReceiptRules.pdf)
                    .frame(height: 104)
                Text(receipt.name)
                    .font(.caption)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(PennyColor.surface, in: cardShape)
        }
    }

    /// The receipt under the split on iPad: a ruled strip with its name.
    private func receiptBanner(_ receipt: ReceiptReference) -> some View {
        receiptButton(receipt) {
            Label(receipt.name, systemImage: receipt.mime == ReceiptRules.pdf ? "doc.text" : "receipt")
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 126)
                .background(PennyColor.secondarySurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(
                        PennyColor.separator, lineWidth: 0.5))
        }
    }

    private func receiptButton(_ receipt: ReceiptReference, @ViewBuilder label: () -> some View) -> some View {
        Button {
            previewing = ReceiptPreviewRequest(receipt: receipt)
        } label: {
            label().contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Receipt, \(receipt.name), \(ReceiptRules.kind(receipt.mime))")
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens the receipt")
        .accessibilityIdentifier("entryDetail.receipt")
    }
}

/// The cards' receipt thumbnail (`.paper`): a sheet with a few ruled lines and a total line at the
/// foot. A PDF draws its document glyph on the sheet.
private struct ReceiptPaper: View {
    let pdf: Bool
    private static let widths: [CGFloat] = [0.6, 1, 0.8, 1, 0.4]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(Self.widths.enumerated()), id: \.offset) { _, width in
                line(width)
            }
            Spacer(minLength: 0)
            line(0.7)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 9)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay {
            if pdf {
                Image(systemName: "doc.text").font(.title2).foregroundStyle(PennyColor.secondaryLabel)
            }
        }
        .background(PennyColor.secondarySurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PennyColor.separator, lineWidth: 0.5)
        )
        .accessibilityHidden(true)
    }

    private func line(_ fraction: CGFloat) -> some View {
        GeometryReader { proxy in
            Capsule().fill(PennyColor.fill).frame(width: proxy.size.width * fraction)
        }
        .frame(height: 4)
    }
}

/// Text for the entry detail's split.
enum EntryDetailText {
    struct Split: Equatable {
        /// "Equally · 2 people" or "Custom share".
        let method: String
        /// The head count of an equal split, nil for a custom share.
        let people: Int64?
    }

    /// The subtitle's date, as the cards and the web's `longDay` read it: "Today", "Yesterday",
    /// "Monday, Nov 9", with the year when it isn't this year's.
    static func day(_ day: CalendarDate, today: CalendarDate) -> String {
        if day == today { return "Today" }
        if day == today.adding(days: -1) { return "Yesterday" }
        let style = Date.FormatStyle.dateTime.weekday(.wide).month(.abbreviated).day()
        return DayText.date(day).formatted(day.year == today.year ? style : style.year())
    }

    static func hasSplitOrReceipt(_ entry: LedgerEntry) -> Bool {
        entry.kind == .expense && (entry.share != entry.total || entry.receipt != nil)
    }

    static func split(_ entry: LedgerEntry) -> Split? {
        split(kind: entry.kind, total: entry.total, share: entry.share)
    }

    /// How an expense is split, as the web's `splitSummary` reads it. The ledger keeps only the
    /// share and the total, so an equal split is recognised from them (`Money.personalShare`
    /// rounds the total over the people half up); any other share is a custom one. Nil when the
    /// entry isn't split.
    static func split(kind: EntryKind, total: Int64, share: Int64) -> Split? {
        guard kind == .expense, share != total, share > 0, total > 0 else { return nil }
        let people = Money.divideRoundingHalfUp(total, by: share)
        if (2...100).contains(people), Money.divideRoundingHalfUp(total, by: people) == share {
            return Split(method: "Equally · \(people) people", people: people)
        }
        return Split(method: "Custom share", people: nil)
    }

    /// "1 other person", "3 other people", or "Other people" for a custom share.
    static func others(_ split: Split) -> String {
        guard let people = split.people else { return "Other people" }
        return people == 2 ? "1 other person" : "\(people - 1) other people"
    }
}
