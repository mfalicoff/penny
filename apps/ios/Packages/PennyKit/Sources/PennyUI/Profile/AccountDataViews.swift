import Foundation
import PennyData
import PennyDesign
import SwiftUI

/// The pages under Settings › Profile › Your data (MAZ-152).
enum AccountDataPage: Hashable, Identifiable {
    case export, delete

    var id: Self { self }
}

/// Settings › Profile › Delete account (card `iphone-delete-account`): what goes, what stays for
/// the other members of the person's households and trips, and the password to confirm. An
/// account that signs in with a provider has no password, so its session confirms. The server
/// refuses while a household rule blocks leaving; the page shows that reason and nothing is
/// deleted. Afterwards the app is back at sign-in, which says the account was deleted.
struct DeleteAccountView: View {
    @Environment(ShellModel.self) private var shell
    let profile: WireProfile

    @State private var password = ""
    @State private var failure: String?
    @State private var deleting = false
    @State private var exporting = false
    @FocusState private var passwordFocused: Bool

    private var needsPassword: Bool { profile.signIn == "password" }

    var body: some View {
        List {
            Section { top }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
            Section {
                ForEach(AccountDataText.deleted, id: \.text) { item in
                    DeletionItem(systemImage: item.systemImage, text: item.text)
                        .listRowInsets(AccountDataText.itemInsets)
                }
            } header: {
                Text("Deleted from \(host)").cardSectionHeader()
            }
            if !staying.isEmpty {
                Section {
                    DeletionItem(
                        systemImage: "house", text: "Shared expenses in \(AccountDataText.join(staying))",
                        detail: "Members keep them, and see you as “Former member”."
                    )
                    .listRowInsets(AccountDataText.itemInsets)
                    .accessibilityIdentifier("deleteAccount.staysForOthers")
                } header: {
                    Text("Stays for others").cardSectionHeader()
                }
            }
            if needsPassword {
                Section {
                    passwordField
                        .listRowInsets(EdgeInsets(top: 9, leading: 16, bottom: 9, trailing: 16))
                } header: {
                    Text("Confirm").cardSectionHeader()
                }
            }
            Section {
                VStack(spacing: 10) {
                    if let failure {
                        Text(failure)
                            .font(.footnote)
                            .foregroundStyle(PennyColor.danger)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 16)
                            .accessibilityIdentifier("deleteAccount.error")
                    }
                    DeleteButton(busy: deleting, action: delete)
                        .disabled(deleting)
                        .accessibilityIdentifier("deleteAccount.confirm")
                    Text(AccountDataText.backups(policy: shell.auth?.server?.privacyPolicy))
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 16)
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 0, trailing: 0))
        }
        .insetGroupedList()
        .compactListSections()
        .environment(\.defaultMinListRowHeight, 0)
        .contentMargins(.top, 4, for: .scrollContent)
        .background(PennyColor.background)
        .navigationTitle("Delete account")
        .inlineNavigationTitle()
        .navigationDestination(isPresented: $exporting) { ExportAllView() }
        .interactiveDismissDisabled(deleting)
        .navigationBarBackButtonHidden(deleting)
        .task {
            if shell.households.isAvailable, shell.households.load == .idle { await shell.households.refresh() }
        }
        .accessibilityIdentifier("screen.deleteAccount")
    }

    private var host: String {
        shell.account.map { ServerText.host($0.server) } ?? "this server"
    }

    /// Households first, then trips, as the card lists them.
    private var staying: [String] {
        let list = shell.households.households
        return (list.filter { $0.trip == nil } + list.filter { $0.trip != nil }).map(\.name)
    }

    private var top: some View {
        VStack(spacing: 0) {
            Image(systemName: "trash")
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(PennyColor.danger)
                .frame(width: 56, height: 56)
                .background(PennyColor.danger.opacity(0.14), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                .accessibilityHidden(true)
            Text("Delete your account?")
                .font(.title2.weight(.bold))
                .foregroundStyle(PennyColor.label)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
                .accessibilityAddTraits(.isHeader)
            Button {
                exporting = true
            } label: {
                Text(AccountDataText.lead)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
            .accessibilityLabel("This can't be undone. Export your data first if you want a copy.")
            .accessibilityHint("Opens Export your data")
            .accessibilityIdentifier("deleteAccount.export")
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
    }

    private var passwordField: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Your password")
                .font(.caption.weight(.semibold))
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityHidden(true)
            SecureField("", text: $password)
                .accessibilityLabel("Your password")
                .passwordEntry(new: false)
                .submitLabel(.done)
                .focused($passwordFocused)
                .onSubmit(delete)
                .disabled(deleting)
                .accessibilityIdentifier("deleteAccount.password")
        }
    }

    private func delete() {
        guard !deleting, let auth = shell.auth else { return }
        if needsPassword, password.isEmpty {
            failure = AccountDeletionFailure.enterPasswordMessage
            passwordFocused = true
            return
        }
        failure = nil
        deleting = true
        let typed = needsPassword ? password : nil
        Task {
            do throws(AccountDeletionFailure) {
                try await auth.deleteAccount(password: typed)
                // The shell goes away with the signed-in state; sign-in shows next.
            } catch {
                deleting = false
                failure = error.message
                if error.kind == .wrongPassword {
                    password = ""
                    passwordFocused = true
                }
                AccessibilityNotification.Announcement(error.message).post()
            }
        }
    }
}

/// One line under Deleted or Stays for others: a secondary 18pt symbol beside the text.
private struct DeletionItem: View {
    let systemImage: String
    let text: String
    var detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: systemImage)
                .font(.callout)
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(text).font(.subheadline).foregroundStyle(PennyColor.label)
                if let detail {
                    Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The card's full-width red Delete account button.
private struct DeleteButton: View {
    @ScaledMetric(relativeTo: .body) private var height = ControlSize.button
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(.white) }
                Text(busy ? "Deleting…" : "Delete account")
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(PennyColor.danger, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
    }
}

/// Settings › Profile › Export all your data (card `iphone-export-all`): what the ZIP holds, then
/// the file once the server has prepared it, with Save or share. The file is removed when the page
/// closes.
struct ExportAllView: View {
    @Environment(ShellModel.self) private var shell
    @State private var model: AccountExportModel?

    var body: some View {
        List {
            Section {
            } footer: {
                Text("One ZIP file with everything on \(host) that belongs to you.")
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .padding(.horizontal, -10)
                    .padding(.top, -10)
            }
            Section {
                ForEach(AccountDataText.included, id: \.title) { item in
                    IncludedRow(item: item)
                }
            } header: {
                Text("Included").cardSectionHeader()
            }
            Section {
                fileCard
            } footer: {
                Text("Penny prepares the file on your server and doesn't keep a copy after you save it.")
            }
        }
        .insetGroupedList()
        .compactListSections()
        .contentMargins(.top, 4, for: .scrollContent)
        .background(PennyColor.background)
        .navigationTitle("Export your data")
        .inlineNavigationTitle()
        .task {
            let model = model ?? AccountExportModel(service: shell.profile.service)
            self.model = model
            await model.prepare()
        }
        .onDisappear { model?.close() }
        .accessibilityIdentifier("screen.exportAll")
    }

    private var host: String {
        shell.account.map { ServerText.host($0.server) } ?? "this server"
    }

    @ViewBuilder
    private var fileCard: some View {
        switch model?.state ?? .idle {
        case .idle, .preparing:
            HStack(spacing: 12) {
                fileIcon
                VStack(alignment: .leading, spacing: 2) {
                    Text("Preparing your file…").font(.callout.weight(.semibold)).foregroundStyle(PennyColor.label)
                    Text("This can take a minute with many receipts.")
                        .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer(minLength: 0)
                ProgressView()
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("exportAll.preparing")
        case .ready(let file):
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    fileIcon
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.filename)
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(PennyColor.label)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text("\(FileSizeText.text(file.byteCount)) · ready")
                            .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "checkmark.circle")
                        .font(.title3)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("exportAll.file")
                ShareLink(item: file.url, preview: SharePreview(file.filename)) {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.up").font(.footnote.weight(.bold))
                        Text("Save or share").font(.body.weight(.semibold))
                    }
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity, minHeight: ControlSize.glassButton)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .pennyGlass(in: Capsule(), tinted: true)
                .accessibilityIdentifier("exportAll.share")
            }
            .padding(.vertical, 6)
        case .failed(let message):
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    fileIcon
                    Text(message)
                        .font(.callout)
                        .foregroundStyle(PennyColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("exportAll.error")
                }
                GlassCapsuleButton("Try again") {
                    Task { await model?.prepare() }
                }
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("exportAll.retry")
            }
            .padding(.vertical, 6)
        }
    }

    private var fileIcon: some View {
        Image(systemName: "doc.text")
            .font(.title3)
            .foregroundStyle(PennyColor.label)
            .frame(width: 44, height: 44)
            .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// One Included row: the icon tile, the title and its detail, and a check.
private struct IncludedRow: View {
    let item: AccountDataText.Included

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.systemImage).settingsIconTile()
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).foregroundStyle(PennyColor.label)
                if let detail = item.detail {
                    Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "checkmark")
                .font(.body.weight(.light))
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityLabel("Included")
        }
        .cardSettingsRow()
        .accessibilityElement(children: .combine)
    }
}

/// The words of the Your data pages, as on the web.
enum AccountDataText {
    static let deleted: [(systemImage: String, text: String)] = [
        ("list.bullet", "Your entries, accounts, categories and schedules"),
        ("receipt", "Receipts and your receipt email address"),
        ("person.2", "Your name, picture and email"),
        ("rectangle.portrait.and.arrow.right", "Sign-ins on every device"),
    ]

    struct Included {
        let systemImage: String
        let title: String
        let detail: String?
    }

    static let included = [
        Included(systemImage: "list.bullet", title: "Entries", detail: "CSV for spreadsheets, and JSON"),
        Included(systemImage: "wallet.bifold", title: "Accounts, categories and schedules", detail: nil),
        Included(
            systemImage: "person.2", title: "Households and trips", detail: "Shared expenses with everyone's share"),
        Included(systemImage: "receipt", title: "Receipts", detail: "The original files"),
        Included(systemImage: "photo", title: "Profile", detail: "Your name, picture and email"),
    ]

    /// "This can't be undone. Export your data first if you want a copy." with the link in the tint.
    static var lead: AttributedString {
        var text = AttributedString("This can't be undone. ")
        text.foregroundColor = PennyColor.secondaryLabel
        var link = AttributedString("Export your data")
        link.foregroundColor = PennyColor.tintText
        link.inlinePresentationIntent = .stronglyEmphasized
        text.append(link)
        var rest = AttributedString(" first if you want a copy.")
        rest.foregroundColor = PennyColor.secondaryLabel
        text.append(rest)
        return text
    }

    /// "Backups keep deleted data for up to 30 days. Privacy Policy"
    static func backups(policy: URL?) -> AttributedString {
        var text = AttributedString("Backups keep deleted data for up to 30 days.")
        text.foregroundColor = PennyColor.secondaryLabel
        if let policy {
            text.append(AttributedString(" "))
            var link = AttributedString(PrivacyPolicyText.title)
            link.link = policy
            link.foregroundColor = PennyColor.tintText
            link.inlinePresentationIntent = .stronglyEmphasized
            text.append(link)
        }
        return text
    }

    /// The cards' 10pt-tall list lines (`.li`), tighter than a settings row.
    static let itemInsets = EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)

    /// "Apartment", "Apartment and Lisbon", "Apartment, Lisbon and Cottage".
    static func join(_ names: [String]) -> String {
        guard names.count > 1, let last = names.last else { return names.first ?? "" }
        return names.dropLast().joined(separator: ", ") + " and " + last
    }
}

extension View {
    /// The cards' tighter gaps between groups (iOS only; the host build has no section spacing).
    fileprivate func compactListSections() -> some View {
        #if os(iOS)
            listSectionSpacing(.compact)
        #else
            self
        #endif
    }
}
