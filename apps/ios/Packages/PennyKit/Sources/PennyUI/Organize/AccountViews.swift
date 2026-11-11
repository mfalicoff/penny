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
                    Section {
                        ForEach(ledger.accounts, id: \.id) { account in
                            Button {
                                form = AccountFormRequest(account: account)
                            } label: {
                                AccountRow(account: account, usage: ledger.usage(ofAccount: account.id))
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Edit")
                            .accessibilityIdentifier("account.\(account.id)")
                        }
                    } header: {
                        Text("Your accounts")
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
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add account", systemImage: "plus") { form = AccountFormRequest(account: nil) }
                    .disabled(shell.workspace.load.ledger == nil)
                    .accessibilityIdentifier("accounts.add")
            }
        }
        .sheet(item: $form) { request in
            AccountFormSheet(account: request.account).environment(shell)
        }
        .accessibilityIdentifier("screen.accounts")
    }

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
                .font(.body.weight(.semibold))
                .foregroundStyle(PennyColor.label)
                .frame(width: 36, height: 36)
                .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name).font(.body).foregroundStyle(PennyColor.label)
                Text(OrganizeText.accountDetail(account, usage: usage))
                    .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                .foregroundStyle(PennyColor.tertiaryLabel)
                .accessibilityHidden(true)
        }
        .frame(minHeight: ControlSize.row)
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
/// with what was typed and the reason. Editing (`account` set) also offers Remove, which is
/// unavailable, with the reason, while entries or schedules use the account.
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
        let usage = shell.workspace.load.ledger?.usage(ofAccount: model.id) ?? RecordUsage()
        NavigationStack {
            List {
                failureSection
                Section("Name") {
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
                    Text("Type")
                } footer: {
                    Text("Labels where money comes from or how you pay. No bank connection is needed.")
                }
                if !model.isNew {
                    removeSection(usage: usage)
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
                Button("Remove account", role: .destructive, action: remove)
                    .accessibilityIdentifier("accountForm.removeConfirm")
            } message: {
                Text("Nothing uses this account, so no entry changes.")
            }
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

    private func removeSection(usage: RecordUsage) -> some View {
        let note = AccountFormModel.removalNote(name: model.original?.name ?? "", usage: usage)
        return Section {
            Button(role: .destructive) {
                confirmingRemoval = true
            } label: {
                Label("Remove account", systemImage: note == nil ? "trash" : "lock")
                    .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget)
            }
            .disabled(note != nil)
            .accessibilityHint(note ?? "")
            .accessibilityIdentifier("accountForm.remove")
        } footer: {
            if let note {
                Text(note).accessibilityIdentifier("accountForm.removeReason")
            }
        }
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
