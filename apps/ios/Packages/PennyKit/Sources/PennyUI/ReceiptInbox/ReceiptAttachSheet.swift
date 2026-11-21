import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The attach sheet (`receipt-attach-sheet` card): which file (skipped for a one-file email),
/// which entry (Suggested, and Search across every expense), then Confirm with the file's
/// first page, the entry card and the notes, and Attach. Nothing is linked before Attach.
struct ReceiptAttachSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let item: WireReceiptInboxItem
    let attached: (ReceiptAttachment) -> Void

    enum Step: Hashable {
        case entry
        case confirm(String)
    }

    @State private var file: WireReceiptInboxFile?
    @State private var path: [Step] = []
    @State private var shared: [AttachTarget] = []
    @State private var loadingShared = false
    /// The entry being confirmed, as last read (a 409 replaces it with the server's values).
    @State private var confirming: AttachTarget?
    @State private var query = ""

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if ReceiptInboxRules.attachableFiles(item).count > 1 {
                    fileStep
                } else {
                    entryStep
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .accessibilityIdentifier("receiptAttach.cancel")
                }
            }
            .navigationDestination(for: Step.self) { step in
                switch step {
                case .entry: entryStep
                case .confirm:
                    if let confirming, let file {
                        AttachConfirmStep(item: item, file: file, target: confirming) { result in
                            switch result {
                            case .attached(let attachment): finish(attachment)
                            case .changed(let fresh): self.confirming = fresh
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            if file == nil { file = ReceiptInboxRules.preselectedFile(item).flatMap { $0.linked ? nil : $0 } }
            if file == nil { file = ReceiptInboxRules.attachableFiles(item).first }
        }
        .task { await loadShared() }
        .accessibilityIdentifier("screen.receiptAttach")
    }

    // MARK: Which file

    private var fileStep: some View {
        List {
            Section {
                ForEach(ReceiptInboxRules.attachableFiles(item)) { candidate in
                    Button {
                        file = candidate
                    } label: {
                        HStack {
                            InboxFileRow(file: candidate)
                            if file?.receiptId == candidate.receiptId {
                                Image(systemName: "checkmark").foregroundStyle(PennyColor.tint)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(file?.receiptId == candidate.receiptId ? .isSelected : [])
                    .accessibilityIdentifier("attachFile.\(candidate.receiptId)")
                }
            } footer: {
                Text("The first attachment is usually the merchant's receipt.")
            }
            Section {
                PennyButton("Next") { path.append(.entry) }
                    .disabled(file == nil)
                    .accessibilityIdentifier("receiptAttach.next")
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
        .insetGroupedList()
        .navigationTitle("Which receipt?")
        .toolbarTitleDisplayModeInline()
    }

    // MARK: Which entry

    private var targets: [AttachTarget] {
        let personal = shell.workspace.load.ledger.map(ReceiptInboxRules.personalTargets) ?? []
        return personal + shared
    }

    private var entryStep: some View {
        let received = ReceiptInboxRules.receivedDay(item.receivedAt)
        let all = targets
        let suggested = ReceiptInboxRules.suggestions(all, received: received)
        let results = ReceiptInboxRules.search(all, query: query)
        return List {
            if query.isEmpty {
                Section {
                    if suggested.isEmpty {
                        Text(
                            loadingShared
                                ? "Looking for expenses around \(EntryText.day(received, today: shell.today))…"
                                : "No expense without a receipt within a week of this email. Search for one instead."
                        )
                        .foregroundStyle(PennyColor.secondaryLabel)
                    }
                    ForEach(suggested) { target in targetRow(target) }
                } header: {
                    Text("Suggested")
                } footer: {
                    Text("Expenses without a receipt, up to 7 days either side of the day this email arrived.")
                }
                .accessibilityIdentifier("receiptAttach.suggested")
            } else {
                Section("Results") {
                    if results.isEmpty {
                        Text("No expense matches \u{201C}\(query)\u{201D}.").foregroundStyle(PennyColor.secondaryLabel)
                    }
                    ForEach(results.prefix(50)) { target in targetRow(target) }
                }
            }
        }
        .insetGroupedList()
        .searchable(text: $query, prompt: "Search expenses")
        .navigationTitle("Attach to…")
        .toolbarTitleDisplayModeInline()
    }

    private func targetRow(_ target: AttachTarget) -> some View {
        Button {
            confirming = target
            path.append(.confirm(target.id))
        } label: {
            AttachTargetCard(target: target, framed: false)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("attachTarget.\(Self.key(target))")
    }

    /// The row identifier's model id (`entry-<id>` or `shared-<id>`).
    static func key(_ target: AttachTarget) -> String {
        switch target {
        case .personal(let entry): "entry-\(entry.id)"
        case .shared(let expense, _): "shared-\(expense.id)"
        }
    }

    private func loadShared() async {
        guard let attacher = shell.receiptAttacher, shell.households.isAvailable else { return }
        loadingShared = true
        defer { loadingShared = false }
        if shell.households.load == .idle { await shell.households.refresh() }
        shared = await attacher.sharedTargets(
            shell.households.households, received: ReceiptInboxRules.receivedDay(item.receivedAt))
    }

    private func finish(_ attachment: ReceiptAttachment) {
        attached(attachment)
        dismiss()
        Task {
            await shell.receiptInbox.linksChanged()
            if case .shared(let expense, _) = attachment.target {
                await shell.households.model(for: expense.householdId)?.didSave()
            }
        }
    }
}

/// An entry as the attach sheet shows it: category icon, title, total and date, the household
/// for a shared expense.
struct AttachTargetCard: View {
    @Environment(ShellModel.self) private var shell
    let target: AttachTarget
    var framed = true

    var body: some View {
        HStack(spacing: 12) {
            CategoryIcon(symbol: symbol, color: color, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(target.title).font(.headline).foregroundStyle(PennyColor.label).lineLimit(2)
                Text(InboxText.targetDetail(target, currency: shell.currency, today: shell.today))
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: Metrics.minTouchTarget)
        .padding(framed ? 12 : 0)
        .background {
            if framed {
                RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous).fill(PennyColor.surface)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch target {
        case .personal(let entry):
            EntryText.tileSymbol(entry.kind, category: shell.workspace.load.ledger?.category(id: entry.categoryId))
        case .shared(let expense, _): expense.category.symbol
        }
    }

    private var color: Color {
        switch target {
        case .personal(let entry):
            EntryText.tileColor(
                entry.kind, category: shell.workspace.load.ledger?.category(id: entry.categoryId), id: entry.categoryId)
        case .shared(let expense, _): expense.category.tint
        }
    }
}

/// Confirm: the file's first page (the full viewer one tap away), the entry, the notes, then
/// Attach. A shared expense that changed meanwhile comes back here with its new values.
struct AttachConfirmStep: View {
    @Environment(ShellModel.self) private var shell
    let item: WireReceiptInboxItem
    let file: WireReceiptInboxFile
    let target: AttachTarget
    let finished: (Outcome) -> Void

    enum Outcome {
        case attached(ReceiptAttachment)
        case changed(AttachTarget)
    }

    @State private var previewing: ReceiptPreviewRequest?
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Button {
                    previewing = ReceiptPreviewRequest(receipt: ReceiptInboxRules.reference(file))
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        ReceiptFirstPage(file: file)
                        InboxFileRow(file: file)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the receipt")
                .accessibilityIdentifier("receiptAttach.preview")
                AttachTargetCard(target: target)
                notes
                if let problem {
                    StatusBanner(tone: .error, title: "Couldn't attach the receipt", message: problem)
                        .accessibilityIdentifier("receiptAttach.error")
                }
                PennyButton(saving ? "Attaching…" : "Attach", systemImage: "paperclip") {
                    Task { await attach() }
                }
                .disabled(saving || !shell.receiptInbox.isAvailable)
                .accessibilityLabel(InboxText.attachLabel(file, target, currency: shell.currency))
                .accessibilityIdentifier("receiptAttach.confirm")
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(PennyColor.background)
        .navigationTitle("Attach receipt")
        .toolbarTitleDisplayModeInline()
        .receiptViewer($previewing) { request in
            ReceiptPreviewView(receipt: request.receipt, transfers: shell.receipts, context: nil)
        }
    }

    @ViewBuilder
    private var notes: some View {
        if let household = target.householdName {
            note(
                "Members of \(household) will be able to see this receipt.", symbol: "person.2"
            )
            .accessibilityIdentifier("receiptAttach.sharedNote")
        }
        if let current = target.receiptName {
            note(
                "This replaces \(current). The current receipt stays in Penny and can be attached again.",
                symbol: "arrow.triangle.2.circlepath"
            )
            .accessibilityIdentifier("receiptAttach.replaceNote")
        }
        if !item.senderVerified {
            note(
                "Penny couldn't verify who sent this email. Check the receipt before attaching it.",
                symbol: "exclamationmark.shield"
            )
            .accessibilityIdentifier("receiptAttach.unverifiedNote")
        }
    }

    private func note(_ text: String, symbol: String) -> some View {
        Label {
            Text(verbatim: text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol).foregroundStyle(PennyColor.secondaryLabel)
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func attach() async {
        guard let attacher = shell.receiptAttacher else { return }
        saving = true
        defer { saving = false }
        switch await attacher.attach(file, to: target) {
        case .success(let attachment):
            finished(.attached(attachment))
        case .failure(.changed(let fresh)):
            problem = ReceiptAttachFailure.changed(fresh).message
            finished(.changed(fresh))
        case .failure(let failure):
            problem = failure.message
        }
    }
}

/// Entry form › Receipt › From inbox: the inbox as a picker. Choosing a file attaches it to the
/// form the way a finished upload does, with no upload.
struct ReceiptInboxPicker: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    let choose: (WireReceiptInboxFile) -> Void
    @State private var previewing: ReceiptPreviewRequest?

    var body: some View {
        NavigationStack {
            List {
                let items = shell.receiptInbox.list(.toAttach)
                if items.isEmpty {
                    Text("Nothing to attach.").foregroundStyle(PennyColor.secondaryLabel)
                }
                ForEach(items) { item in
                    Section {
                        ForEach(ReceiptInboxRules.attachableFiles(item)) { file in
                            HStack {
                                Button {
                                    choose(file)
                                    dismiss()
                                } label: {
                                    InboxFileRow(file: file)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(
                                    "\(ReceiptInboxRules.fileLabel(file)), \(InboxText.fileDetail(file)), from \(ReceiptInboxText.sender(item))"
                                )
                                .accessibilityHint("Attaches it to this entry")
                                .accessibilityIdentifier("inboxFile.\(file.receiptId)")
                                Button("View", systemImage: "eye") {
                                    previewing = ReceiptPreviewRequest(receipt: ReceiptInboxRules.reference(file))
                                }
                                .labelStyle(.iconOnly)
                                .frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
                                .buttonStyle(.borderless)
                            }
                        }
                    } header: {
                        HStack {
                            Text(verbatim: ReceiptInboxText.sender(item))
                            if !item.senderVerified { UnverifiedBadge() }
                        }
                    } footer: {
                        Text(verbatim: "\(ReceiptInboxText.subject(item)) · \(InboxText.received(item))")
                    }
                }
            }
            .insetGroupedList()
            .navigationTitle("From inbox")
            .toolbarTitleDisplayModeInline()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
            }
            .receiptViewer($previewing) { request in
                ReceiptPreviewView(receipt: request.receipt, transfers: shell.receipts, context: nil)
            }
        }
        .task { await shell.receiptInbox.refresh(.toAttach) }
        .accessibilityIdentifier("screen.receiptInboxPicker")
    }
}
