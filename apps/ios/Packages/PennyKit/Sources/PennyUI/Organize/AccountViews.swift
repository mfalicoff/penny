import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Accounts (`accounts` card): labels for how money is paid or received, with what uses each.
/// Never a balance: Penny doesn't connect to banks. Tapping a row edits it; + adds one.
struct AccountsListView: View {
    @Environment(ShellModel.self) private var shell
    @State private var form: AccountFormRequest?

    var body: some View {
        WorkspaceContent { ledger in
            List {
                if !ledger.accounts.isEmpty {
                    // The card's subtitle under the large title (`.lsub`), as on Recurring.
                    Section {
                        Text(Self.subtitle).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                            .accessibilityIdentifier("accounts.subtitle")
                    }
                    .compactSectionSpacing()
                    Section {
                        ForEach(ledger.accounts, id: \.id) { account in
                            Button {
                                form = AccountFormRequest(account: account)
                            } label: {
                                AccountRow(account: account, usage: ledger.usage(ofAccount: account.id))
                            }
                            .buttonStyle(.plain)
                            .cardSettingsRow()
                            .accessibilityHint("Edit")
                            .accessibilityIdentifier("account.\(account.id)")
                        }
                    } header: {
                        Text("Your accounts").cardSectionHeader()
                    } footer: {
                        Text(Self.footer)
                    }
                }
            }
            .insetGroupedList()
            .overlay {
                if ledger.accounts.isEmpty {
                    PennyStateView(
                        .empty, title: "No accounts",
                        message: "Accounts are labels for how you pay and get paid, like a card or a bank account. "
                            + "Penny never tracks balances.",
                        actionTitle: "Add account"
                    ) { form = AccountFormRequest(account: nil) }
                }
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Accounts")
        // The card's large title; Settings' sheet root is inline, and a pushed page would inherit it.
        .toolbarTitleDisplayModeLarge()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add account", systemImage: "plus") { form = AccountFormRequest(account: nil) }
                    .neutralToolbarGlyph()
                    .disabled(shell.workspace.load.ledger == nil)
                    .accessibilityIdentifier("accounts.add")
            }
        }
        .sheet(item: $form) { request in
            AccountFormSheet(account: request.account).environment(shell)
        }
        .accessibilityIdentifier("screen.accounts")
    }

    static let subtitle = "Labels for how you pay and get paid."

    static let footer =
        "Penny never connects to your bank and doesn't track balances. An account linked to entries or "
        + "schedules can be renamed, but not removed until those are moved to another account."
}

/// Which account form to show: a new account, or one to edit.
struct AccountFormRequest: Identifiable {
    let id = UUID()
    let account: PaymentAccount?
}

private struct AccountRow: View {
    let account: PaymentAccount
    let usage: RecordUsage

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: OrganizeText.accountSymbol(account.type))
                .font(.callout)
                .foregroundStyle(PennyColor.label)
                .frame(width: 30, height: 30)
                .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(account.name).font(.body).foregroundStyle(PennyColor.label)
                Text(OrganizeText.accountDetail(account, usage: usage))
                    .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.tertiaryLabel)
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The account form (`account-form`, `account-edit`), as a sheet. Reusable: Accounts presents
/// it, and an entry or schedule form presents it inline to create an account without losing
/// its own draft.
///
/// ```swift
/// .sheet(isPresented: $addingAccount) {
///     AccountFormSheet { account in draft.accountId = account.id }
/// }
/// ```
///
/// `onSaved` runs once the account is kept (offline included), with the stored account (its
/// trimmed name and its id), right before the sheet closes. A failed save keeps the sheet open
/// with what was typed and the reason. Editing (`account` set) also offers Remove; while
/// entries or schedules use the account, it offers "Move them to" another account and "Move and
/// remove" instead (`MoveAndRemoveSection`).
struct AccountFormSheet: View {
    @Environment(ShellModel.self) private var shell
    @Environment(\.dismiss) private var dismiss
    @State private var model: AccountFormModel
    @State private var confirmingRemoval = false
    @FocusState private var nameFocused: Bool
    private let onSaved: ((PaymentAccount) -> Void)?

    init(account: PaymentAccount? = nil, type: AccountType = .bank, onSaved: ((PaymentAccount) -> Void)? = nil) {
        _model = State(initialValue: AccountFormModel(account: account, type: type))
        self.onSaved = onSaved
    }

    var body: some View {
        let ledger = shell.workspace.load.ledger ?? Ledger(categories: [])
        let usage = ledger.usage(ofAccount: model.id)
        NavigationStack {
            List {
                failureSection
                CardSection("Name") {
                    TextField("Main chequing, Visa, wallet", text: $model.name)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .onSubmit(save)
                        .frame(minHeight: Metrics.minTouchTarget)
                        .accessibilityLabel("Account name")
                        .accessibilityIdentifier("accountForm.name")
                }
                Section {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
                        ForEach(AccountType.allCases, id: \.self) { type in
                            AccountTypeCard(type: type, selected: model.type == type) { model.type = type }
                        }
                    }
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                } header: {
                    Text("Type").cardSectionHeader()
                } footer: {
                    Text("Labels where money comes from or how you pay. No bank connection is needed.")
                }
                if !model.isNew {
                    removeSection(usage: usage, ledger: ledger)
                }
            }
            .insetGroupedList()
            .background(PennyColor.background)
            .disabled(model.isSaving)
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("accountForm.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark", action: save)
                        .disabled(!model.canSave)
                        .accessibilityIdentifier("accountForm.save")
                }
            }
            .confirmationDialog(
                "Remove \(model.original?.name ?? "account")?", isPresented: $confirmingRemoval,
                titleVisibility: .visible
            ) {
                if usage.isInUse {
                    Button("Move and remove", role: .destructive) { moveAndRemove(ledger) }
                        .accessibilityIdentifier("accountForm.removeConfirm")
                } else {
                    Button("Remove account", role: .destructive, action: remove)
                        .accessibilityIdentifier("accountForm.removeConfirm")
                }
            } message: {
                if usage.isInUse, let target = model.moveTo.flatMap(ledger.account(id:)) {
                    let name = model.original?.name ?? "this account"
                    Text("\(OrganizeText.uses(usage)) move to \(target.name), then \(name) is removed.")
                } else {
                    Text("Nothing uses this account, so no entry changes.")
                }
            }
            .pennySolidBars()
        }
        .tint(PennyColor.tint)
        .interactiveDismissDisabled(model.isSaving)
        .onAppear { if model.isNew { nameFocused = true } }
        .accessibilityIdentifier("screen.accountForm")
    }

    @ViewBuilder
    private var failureSection: some View {
        if let failure = model.failure {
            let retry: (() -> Void)? = model.canSave ? { save() } : nil
            Section {
                SaveErrorBanner(failure: failure, retry: retry)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
        }
    }

    private func removeSection(usage: RecordUsage, ledger: Ledger) -> some View {
        let targets = model.moveTargets(in: ledger)
        return MoveAndRemoveSection(
            noun: "account",
            note: AccountFormModel.removalNote(
                name: model.original?.name ?? "", usage: usage, canMove: !targets.isEmpty),
            targets: targets.map { ($0.id, $0.name) }, moveTo: $model.moveTo,
            ids: .init(
                moveTo: "accountForm.moveTo", moveAndRemove: "accountForm.moveAndRemove", remove: "accountForm.remove",
                reason: "accountForm.removeReason")
        ) { confirmingRemoval = true }
    }

    private func save() {
        Task {
            guard let account = await model.save(with: { await shell.commit($0, summary: $1) }) else { return }
            onSaved?(account)
            dismiss()
        }
    }

    private func remove() {
        Task {
            if await model.remove(with: { await shell.commit($0, summary: $1) }) { dismiss() }
        }
    }

    private func moveAndRemove(_ ledger: Ledger) {
        Task {
            if await model.moveAndRemove(in: ledger, with: { await shell.commit($0, summary: $1) }) { dismiss() }
        }
    }
}

/// One of the four account types as a selectable card.
private struct AccountTypeCard: View {
    let type: AccountType
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: OrganizeText.accountSymbol(type))
                        .font(.title3)
                        .foregroundStyle(selected ? PennyColor.tint : PennyColor.secondaryLabel)
                    Spacer()
                    if selected {
                        Image(systemName: "checkmark.circle").foregroundStyle(PennyColor.tint)
                    }
                }
                Text(OrganizeText.accountType(type)).font(.headline).foregroundStyle(PennyColor.label)
                    .multilineTextAlignment(.leading)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .topLeading)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous)
                    .stroke(selected ? PennyColor.tint : .clear, lineWidth: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(OrganizeText.accountType(type))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("accountForm.type.\(type.rawValue)")
    }
}
