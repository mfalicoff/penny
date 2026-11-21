import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Receipts to attach: the "Receipts to attach" row on Home (only while there is something to
/// attach) and in Settings, with its count.
struct ReceiptInboxRow: View {
    @Environment(ShellModel.self) private var shell
    /// Home shows it as a card; Settings as a list row.
    var card = false
    let open: () -> Void

    var body: some View {
        let inbox = shell.receiptInbox
        let count = inbox.toAttachCount
        Button(action: open) {
            HStack(spacing: 12) {
                Image(systemName: "tray.and.arrow.down")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(PennyColor.tintText)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Receipts to attach").font(.body).foregroundStyle(PennyColor.label)
                    if !inbox.isAvailable {
                        Text(InboxText.offline).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                Spacer(minLength: 8)
                if count > 0 {
                    Text(inbox.hasMoreToAttach ? "\(count)+" : "\(count)")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(PennyColor.label)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(PennyColor.fill, in: Capsule())
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel).accessibilityHidden(true)
            }
            .frame(minHeight: Metrics.minTouchTarget)
            .padding(card ? 12 : 0)
            .background {
                if card {
                    RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous).fill(PennyColor.surface)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!inbox.isAvailable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ReceiptInboxRules.spokenCount(count))
        .accessibilityHint(inbox.isAvailable ? "Opens your receipt inbox" : InboxText.offline)
        .accessibilityAddTraits(.isButton)
    }
}

/// Home's row: shown only when the feature is on and there is something to attach.
struct ReceiptInboxHomeRow: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        Group {
            if shell.receiptInbox.isEnabled, shell.receiptInbox.toAttachCount > 0 {
                ReceiptInboxRow(card: true) { shell.route.push(.receiptInbox(itemID: nil)) }
                    .accessibilityIdentifier("home.receiptInbox")
            }
        }
        .task { await shell.receiptInbox.refresh() }
    }
}

/// The receipt inbox (`receipt-inbox` card): items newest first, To attach (the default) and
/// Attached (the last 30 days). Swipe a row for Discard. Opened from a notification, it opens
/// that item once it is found.
struct ReceiptInboxView: View {
    @Environment(ShellModel.self) private var shell
    /// The item a notification opened.
    var openItemID: String?
    @State private var filter: ReceiptInboxFilter = .toAttach
    @State private var selected: InboxSelection?
    @State private var discarding: WireReceiptInboxItem?
    @State private var problem: String?
    @State private var attachment: ReceiptAttachment?
    @State private var openedFromLink = false

    var body: some View {
        let inbox = shell.receiptInbox
        List {
            if !inbox.isAvailable {
                Section {
                    StatusBanner(tone: .offline, title: "You're offline", message: InboxText.offline)
                        .accessibilityIdentifier("receiptInbox.offline")
                }
            }
            if attachment != nil {
                Section { AttachConfirmation(attachment: $attachment) }
            }
            if let problem {
                Section {
                    StatusBanner(tone: .error, title: "Something went wrong", message: problem) {
                        Button("Dismiss") { self.problem = nil }
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: Metrics.minTouchTarget)
                    }
                    .accessibilityIdentifier("receiptInbox.error")
                }
            }
            Section {
                Picker("Show", selection: $filter) {
                    Text("To attach").tag(ReceiptInboxFilter.toAttach)
                    Text("Attached").tag(ReceiptInboxFilter.attached)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("receiptInbox.filter")
            } footer: {
                if filter == .attached { Text("Emails you attached in the last 30 days.") }
            }
            items(inbox)
        }
        .insetGroupedList()
        .background(PennyColor.background)
        .navigationTitle("Receipts to attach")
        .navigationDestination(item: $selected) { selection in
            ReceiptInboxItemView(id: selection.id) { done in
                attachment = done
                selected = nil
            }
        }
        .refreshable { await inbox.refresh(filter) }
        .task(id: filter) { await inbox.refresh(filter) }
        .task { await openLinkedItem() }
        // A personal attach syncs later: read the list again once it has.
        .onChange(of: shell.workspace.sync.pending) { old, new in
            if new < old { Task { await inbox.linksChanged() } }
        }
        .confirmationDialog(
            "Discard this email?", isPresented: discardBinding, titleVisibility: .visible, presenting: discarding
        ) { item in
            Button("Discard", role: .destructive) { Task { await discard(item) } }
                .accessibilityIdentifier("receiptInbox.confirmDiscard")
            Button("Cancel", role: .cancel) {}
        } message: { item in
            Text(verbatim: ReceiptInboxRules.discardMessage(item))
        }
        .accessibilityIdentifier("screen.receiptInbox")
    }

    @ViewBuilder
    private func items(_ inbox: ReceiptInboxModel) -> some View {
        let list = inbox.list(filter)
        switch inbox.load(filter) {
        case .loading where list.isEmpty:
            Section { ProgressView("Loading your receipts…").frame(maxWidth: .infinity) }
        case .failed(let message) where list.isEmpty:
            Section {
                StatusBanner(tone: .error, title: "Couldn't load your receipts", message: message) {
                    InlineActionButton("Try again") { Task { await inbox.refresh(filter) } }
                }
            }
        default:
            if list.isEmpty {
                Section {
                    Text(
                        filter == .toAttach
                            ? "Nothing to attach. Forward a receipt email to your receipt address and it shows up here."
                            : "Nothing attached in the last 30 days."
                    )
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityIdentifier("receiptInbox.empty")
                }
            } else {
                let attaching = attachingInboxItems(shell)
                Section {
                    ForEach(list) { item in
                        Button {
                            selected = InboxSelection(id: item.id)
                        } label: {
                            InboxItemRow(item: item, attaching: attaching.contains(item.id))
                        }
                        .buttonStyle(.plain)
                        .disabled(!inbox.isAvailable)
                        .swipeActions(edge: .trailing) {
                            Button("Discard", systemImage: "trash", role: .destructive) { discarding = item }
                                .accessibilityIdentifier("receiptInbox.discard")
                        }
                        .accessibilityAction(named: "Discard") { discarding = item }
                        .accessibilityIdentifier("inboxItem.\(item.id)")
                    }
                    if inbox.hasMore(filter) {
                        Button("Show older") { Task { await inbox.loadMore(filter) } }
                            .frame(minHeight: Metrics.minTouchTarget)
                            .accessibilityIdentifier("receiptInbox.more")
                    }
                }
            }
        }
    }

    private var discardBinding: Binding<Bool> {
        Binding(get: { discarding != nil }, set: { if !$0 { discarding = nil } })
    }

    private func discard(_ item: WireReceiptInboxItem) async {
        problem = await shell.receiptInbox.discard(item)
    }

    private func openLinkedItem() async {
        guard let openItemID, !openedFromLink else { return }
        openedFromLink = true
        if let item = await shell.receiptInbox.locate(openItemID) {
            if item.status == "attached" { filter = .attached }
            selected = InboxSelection(id: item.id)
        } else if shell.receiptInbox.isAvailable {
            problem = InboxText.unavailable
        }
    }
}

struct InboxSelection: Hashable, Identifiable {
    let id: String
}

/// One email: sender, subject on one line, received date, the number of files, and the
/// badges. Every value from the email is plain text.
struct InboxItemRow: View {
    let item: WireReceiptInboxItem
    let attaching: Bool

    var body: some View {
        let now = Date()
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "envelope")
                .font(.title3)
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: ReceiptInboxText.sender(item))
                        .font(.headline)
                        .foregroundStyle(PennyColor.label)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(verbatim: InboxText.received(item))
                        .font(.footnote)
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
                Text(verbatim: ReceiptInboxText.subject(item))
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .lineLimit(1)
                    .truncationMode(.tail)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { badges(now) }
                    VStack(alignment: .leading, spacing: 4) { badges(now) }
                }
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: Metrics.minTouchTarget)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(InboxText.rowLabel(item, attaching: attaching, now: now))
        .accessibilityHint("Opens the email's receipts")
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder
    private func badges(_ now: Date) -> some View {
        Text(verbatim: InboxText.files(item.files.count))
            .font(.footnote)
            .foregroundStyle(PennyColor.secondaryLabel)
        if attaching {
            Label("Attaching…", systemImage: "arrow.triangle.2.circlepath")
                .font(.footnote)
                .foregroundStyle(PennyColor.pending)
        } else if let progress = ReceiptInboxRules.progress(item) {
            Text(verbatim: progress).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
        }
        if !item.senderVerified { UnverifiedBadge() }
        if let expiry = ReceiptInboxRules.expiryNotice(item, now: now) {
            Text(verbatim: expiry).font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.pending)
        }
    }
}

/// One email's receipts (`receipt-inbox-item` card): the files in order (the email first),
/// each opening the receipt viewer, then Attach to…, New expense, Done (partly attached) and
/// Discard.
struct ReceiptInboxItemView: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let id: String
    /// Called after attaching: the inbox shows the confirmation and this page closes.
    let attached: (ReceiptAttachment) -> Void
    @State private var previewing: ReceiptPreviewRequest?
    @State private var attaching = false
    @State private var confirm: Confirm?
    @State private var problem: String?

    enum Confirm: String, Identifiable {
        case discard, done
        var id: String { rawValue }
    }

    var body: some View {
        Group {
            if let item = shell.receiptInbox.item(id: id) {
                content(item)
            } else {
                PennyStateView(.unavailable, title: "This receipt isn't available", message: InboxText.unavailable)
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Email")
        .toolbarTitleDisplayModeInline()
        .accessibilityIdentifier("screen.receiptInboxItem")
    }

    private func content(_ item: WireReceiptInboxItem) -> some View {
        let available = shell.receiptInbox.isAvailable
        let attachable = !ReceiptInboxRules.attachableFiles(item).isEmpty
        return List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: ReceiptInboxText.sender(item))
                        .font(.title3.weight(.semibold))
                        .accessibilityIdentifier("receiptInboxItem.sender")
                    Text(verbatim: ReceiptInboxText.subject(item))
                        .font(.body)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .accessibilityIdentifier("receiptInboxItem.subject")
                    Text(verbatim: InboxText.received(item)).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    if !item.senderVerified {
                        UnverifiedBadge().accessibilityIdentifier("receiptInboxItem.unverified")
                    }
                    if let progress = ReceiptInboxRules.progress(item) {
                        Text(verbatim: progress).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    if let expiry = ReceiptInboxRules.expiryNotice(item, now: Date()) {
                        Text(verbatim: expiry).font(.footnote.weight(.semibold)).foregroundStyle(PennyColor.pending)
                            .accessibilityIdentifier("receiptInboxItem.expiry")
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
            if !available {
                Section {
                    StatusBanner(tone: .offline, title: "You're offline", message: InboxText.offline)
                }
            }
            if let problem {
                Section {
                    StatusBanner(tone: .error, title: "Something went wrong", message: problem)
                        .accessibilityIdentifier("receiptInboxItem.error")
                }
            }
            CardSection("Receipts") {
                ForEach(ReceiptInboxRules.orderedFiles(item)) { file in
                    Button {
                        previewing = ReceiptPreviewRequest(receipt: ReceiptInboxRules.reference(file))
                    } label: {
                        InboxFileRow(file: file)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the receipt")
                    .accessibilityIdentifier("inboxFile.\(file.receiptId)")
                }
            }
            Section {
                PennyButton("Attach to…", systemImage: "paperclip") { attaching = true }
                    .disabled(!available || !attachable)
                    .accessibilityIdentifier("receiptInboxItem.attach")
                PennyButton("New expense", systemImage: "plus", role: .secondary) { newExpense(item) }
                    .disabled(!available || !attachable)
                    .accessibilityIdentifier("receiptInboxItem.newExpense")
                if item.status == "partly_attached" {
                    PennyButton("Done", systemImage: "checkmark", role: .secondary) { confirm = .done }
                        .disabled(!available)
                        .accessibilityIdentifier("receiptInboxItem.done")
                }
                PennyButton("Discard", systemImage: "trash", role: .destructive) { confirm = .discard }
                    .disabled(!available)
                    .accessibilityIdentifier("receiptInboxItem.discard")
            } footer: {
                if item.status == "partly_attached" {
                    Text("Done keeps the attached receipts and deletes the rest.")
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
        }
        .insetGroupedList()
        .receiptViewer($previewing) { request in
            ReceiptPreviewView(receipt: request.receipt, transfers: shell.receipts, context: nil)
        }
        .sheet(isPresented: $attaching) {
            ReceiptAttachSheet(item: item) { done in
                attaching = false
                attached(done)
            }
            .environment(shell)
        }
        .confirmationDialog(
            confirm == .done ? "Mark this email as done?" : "Discard this email?",
            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
            titleVisibility: .visible, presenting: confirm
        ) { kind in
            Button(kind == .done ? "Done" : "Discard", role: .destructive) { Task { await run(kind, item) } }
                .accessibilityIdentifier("receiptInboxItem.confirm")
            Button("Cancel", role: .cancel) {}
        } message: { kind in
            Text(verbatim: kind == .done ? ReceiptInboxRules.doneMessage(item) : ReceiptInboxRules.discardMessage(item))
        }
    }

    private func run(_ kind: Confirm, _ item: WireReceiptInboxItem) async {
        let failure =
            kind == .done ? await shell.receiptInbox.finish(item) : await shell.receiptInbox.discard(item)
        if let failure {
            problem = failure
        } else {
            dismiss()
        }
    }

    /// Add entry as an expense: dated the day the email arrived (in this time zone), titled
    /// with the sender, the amount left empty, the preselected file attached.
    private func newExpense(_ item: WireReceiptInboxItem) {
        guard
            let file = ReceiptInboxRules.attachableFiles(item).first(where: { $0.kind == "attachment" })
                ?? ReceiptInboxRules.attachableFiles(item).first
        else { return }
        let title = ReceiptInboxText.sender(item)
        shell.openInboxExpense(
            InboxEntryPrefill(
                title: title == "Unknown sender" ? "" : String(title.prefix(100)),
                date: ReceiptInboxRules.receivedDay(item.receivedAt),
                receipt: ReceiptInboxRules.reference(file)))
    }
}
