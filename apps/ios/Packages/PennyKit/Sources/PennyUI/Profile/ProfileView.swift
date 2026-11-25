import Foundation
import PennyData
import PennyDesign
import PennyDomain
import PhotosUI
import SwiftUI

/// Settings › Profile (MAZ-171; cards `iphone-profile`, `iphone-profile-provider`, `ipad-profile`):
/// the picture with Change picture (and Remove), the name, how the account signs in with Change
/// password, and the footer with the server and its privacy policy (MAZ-169). Fields a sign-in
/// provider manages are read only, with a lock, and say so.
struct ProfileView: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let profile = shell.profile
        Group {
            if !profile.isAvailable {
                PennyStateView(
                    .unavailable, title: "No profile in the demo",
                    message: "Sign in to choose the name and picture your households and trips see.")
            } else if let wire = profile.profile {
                ProfileForm(profile: wire)
            } else if case .failed(let message) = profile.load {
                PennyStateView(
                    .error, title: "Penny couldn't load your profile", message: message, actionTitle: "Try again"
                ) {
                    Task { await profile.refresh() }
                }
                .accessibilityIdentifier("profile.error")
            } else {
                PennyStateView(.loading, title: "Loading your profile…")
            }
        }
        .background(PennyColor.background)
        .navigationTitle("Profile")
        .inlineNavigationTitle()
        .task { await profile.refresh() }
        .accessibilityIdentifier("screen.profile")
    }
}

/// The loaded profile.
private struct ProfileForm: View {
    @Environment(ShellModel.self) private var shell
    let profile: WireProfile

    @State private var name = ""
    @State private var nameError: String?
    @State private var pictureError: String?
    @State private var savingName = false
    @State private var savingPicture = false
    @State private var choosingPicture = false
    @State private var picked: PhotosPickerItem?
    @State private var cropping: CropSource?
    @State private var changingPassword = false
    @State private var passwordChanged = false
    @State private var resendState = ResendState.idle
    @State private var resendError: String?
    @State private var dataPage: AccountDataPage?
    @FocusState private var nameFocused: Bool

    /// iPad: the page beside the Settings list (`ipad-profile`), with the picture beside the name.
    private var isColumn: Bool { shell.route.settingsIsColumn }
    private var shown: String { profile.displayName ?? profile.email }
    private var managed: Bool { !profile.nameEditable || !profile.avatarEditable }
    private var dirty: Bool {
        profile.nameEditable && name.trimmingCharacters(in: .whitespacesAndNewlines) != (profile.displayName ?? "")
    }
    private var busy: Bool { savingName || savingPicture }

    var body: some View {
        List {
            if passwordChanged {
                Section {
                    StatusBanner(
                        tone: .info, title: "Password changed",
                        message: "You're still signed in here. Other devices need the new password."
                    ) {
                        EmptyView()
                    }
                    .accessibilityIdentifier("changePassword.changed")
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section { hero }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
            nameSection
            signInSection
            yourDataSection
        }
        .insetGroupedList()
        .contentMargins(.top, 4, for: .scrollContent)
        .onAppear { name = profile.displayName ?? "" }
        .onChange(of: profile.displayName) { name = profile.displayName ?? "" }
        .toolbar {
            // The phone sheet's copper check saves the name (`iphone-profile`).
            if !isColumn, profile.nameEditable {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save name", systemImage: "checkmark", action: saveName)
                        .disabled(!dirty || busy)
                        .accessibilityIdentifier("profile.save")
                }
            }
        }
        .photosPicker(isPresented: $choosingPicture, selection: $picked, matching: .images)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            picked = nil
            Task { await open(item) }
        }
        .modifier(CropPresenter(source: $cropping) { jpeg in Task { await upload(jpeg) } })
        .sheet(isPresented: $changingPassword) {
            ChangePasswordView { passwordChanged = true }
                .environment(shell)
        }
        .navigationDestination(item: $dataPage) { page in
            switch page {
            case .export: ExportAllView()
            case .delete: DeleteAccountView(profile: profile)
            }
        }
    }

    // MARK: Picture

    @ViewBuilder
    private var hero: some View {
        if isColumn {
            HStack(spacing: 18) {
                picture(size: 76)
                VStack(alignment: .leading, spacing: 6) {
                    Text(shown).font(.title2.weight(.bold)).foregroundStyle(PennyColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                    if managed { managedLine }
                    if profile.avatarEditable { pictureLinks }
                    pictureStatus
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
        } else {
            VStack(spacing: 10) {
                picture(size: 96)
                if managed {
                    Text(shown).font(.title2.weight(.bold)).foregroundStyle(PennyColor.label)
                        .multilineTextAlignment(.center)
                    managedLine
                }
                if profile.avatarEditable { pictureLinks }
                pictureStatus
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 4)
        }
    }

    private func picture(size: Double) -> some View {
        Monogram(
            face: PersonFace(initials: HouseholdPeople.initials(name: shown), avatarUrl: profile.avatarUrl),
            size: size
        )
        .overlay(alignment: .bottomTrailing) {
            if profile.avatarEditable {
                Button {
                    choosingPicture = true
                } label: {
                    Image(systemName: "photo")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(PennyColor.label)
                        .frame(width: size * 0.34, height: size * 0.34)
                        .background(PennyColor.surface, in: Circle())
                        .shadow(color: .black.opacity(0.12), radius: 4, y: 1)
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .accessibilityLabel(profile.avatarUrl == nil ? "Add picture" : "Change picture")
                .offset(x: size * 0.04, y: size * 0.02)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("profile.picture")
    }

    /// "Name and picture from Google" under the name of a provider-managed account.
    private var managedLine: some View {
        let what =
            !profile.nameEditable && !profile.avatarEditable
            ? "Name and picture"
            : !profile.nameEditable
                ? "Name" : "Picture"
        return Label("\(what) from \(ProfileText.provider(profile))", systemImage: "person.badge.key")
            .font(.subheadline)
            .foregroundStyle(PennyColor.secondaryLabel)
            .accessibilityIdentifier("profile.managed")
    }

    @ViewBuilder
    private var pictureLinks: some View {
        HStack(spacing: 24) {
            Button(savingPicture ? "Saving picture…" : profile.avatarUrl == nil ? "Add picture" : "Change picture") {
                choosingPicture = true
            }
            .accessibilityIdentifier("profile.changePicture")
            // The phone card shows only Change picture; Remove sits beside it on iPad, and under it
            // on the phone once there is a picture to remove.
            if profile.avatarUrl != nil {
                Button("Remove", role: .destructive) { Task { await removePicture() } }
                    .foregroundStyle(PennyColor.danger)
                    .accessibilityLabel("Remove picture")
                    .accessibilityIdentifier("profile.removePicture")
            }
        }
        .font(.body.weight(.semibold))
        .foregroundStyle(PennyColor.tintText)
        .buttonStyle(.borderless)
        .disabled(busy)
        .frame(minHeight: Metrics.minTouchTarget)
    }

    @ViewBuilder
    private var pictureStatus: some View {
        if let pictureError {
            Text(pictureError).font(.footnote).foregroundStyle(PennyColor.danger)
                .accessibilityIdentifier("profile.pictureError")
        }
    }

    private func open(_ item: PhotosPickerItem) async {
        pictureError = nil
        guard let data = try? await item.loadTransferable(type: Data.self), let source = CropSource(data: data) else {
            pictureError = "Penny can't open this picture. Choose another one."
            return
        }
        cropping = source
    }

    private func upload(_ jpeg: Data) async {
        savingPicture = true
        pictureError = await shell.profile.uploadPicture(jpeg)
        savingPicture = false
    }

    private func removePicture() async {
        savingPicture = true
        pictureError = await shell.profile.removePicture()
        savingPicture = false
    }

    // MARK: Name

    private var nameSection: some View {
        Section {
            HStack {
                if profile.nameEditable {
                    TextField("Name", text: $name, prompt: Text("Your name"))
                        .personNameEntry()
                        .submitLabel(.done)
                        .focused($nameFocused)
                        .onSubmit(saveName)
                        .disabled(savingName)
                } else {
                    Text(profile.displayName ?? "").foregroundStyle(PennyColor.label)
                    Spacer()
                    Image(systemName: "lock")
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .accessibilityLabel("Read only")
                }
            }
            .cardSettingsRow()
            .accessibilityElement(children: profile.nameEditable ? .contain : .combine)
            .accessibilityIdentifier("profile.name")
            if isColumn, dirty {
                Button(savingName ? "Saving…" : "Save name", action: saveName)
                    .fontWeight(.semibold)
                    .disabled(busy)
                    .cardSettingsRow()
                    .accessibilityIdentifier("profile.save")
            }
        } header: {
            Text("Name").cardSectionHeader()
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if let nameError {
                    Text(nameError).foregroundStyle(PennyColor.danger)
                        .accessibilityIdentifier("profile.nameError")
                }
                Text(ProfileText.nameNote(profile))
            }
        }
    }

    private func saveName() {
        guard dirty, !busy else { return }
        nameError = nil
        savingName = true
        let text = name
        Task {
            nameError = await shell.profile.saveName(text)
            savingName = false
            if nameError == nil { nameFocused = false }
        }
    }

    // MARK: Your data (MAZ-152)

    /// Export all your data and Delete account, with the server and its privacy policy under them.
    private var yourDataSection: some View {
        Section {
            DataRow(
                systemImage: "arrow.down", title: "Export all your data",
                detail: "Entries, receipts and shared expenses", destructive: false
            ) { dataPage = .export }
            .accessibilityIdentifier("profile.exportAll")
            DataRow(systemImage: "trash", title: "Delete account", detail: nil, destructive: true) {
                dataPage = .delete
            }
            .accessibilityIdentifier("profile.deleteAccount")
        } header: {
            Text("Your data").cardSectionHeader()
        } footer: {
            if let server = shell.account?.server {
                Text(
                    PrivacyPolicyText.footer(
                        host: ServerText.host(server), policy: shell.auth?.server?.privacyPolicy)
                )
                .font(.footnote)
                .accessibilityIdentifier("profile.footer")
            }
        }
    }

    // MARK: Sign-in

    enum ResendState: Equatable {
        case idle, sending, sent

        var title: String {
            switch self {
            case .idle: "Resend link"
            case .sending: "Sending…"
            case .sent: "Link sent. Check your inbox."
            }
        }
    }

    /// MAZ-172: Not verified (and Resend link) only while the server sends email.
    private var showsUnverified: Bool {
        profile.signIn == "password" && !profile.emailVerified && shell.auth?.server?.emailEnabled == true
    }

    /// The Sign-in row's trailing state (`iphone-profile`, `ipad-profile`): Verified, or Not verified.
    @ViewBuilder
    private var verificationMark: some View {
        if profile.emailVerified {
            Label("Verified", systemImage: "checkmark.circle")
                .labelStyle(VerificationLabelStyle())
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityIdentifier("profile.emailVerified")
        } else if showsUnverified {
            Label("Not verified", systemImage: "exclamationmark.circle")
                .labelStyle(VerificationLabelStyle())
                .foregroundStyle(PennyColor.pending)
                .accessibilityIdentifier("profile.emailUnverified")
        }
    }

    private func resendVerification() {
        guard resendState == .idle, let auth = shell.auth else { return }
        resendState = .sending
        resendError = nil
        Task {
            resendError = await auth.resendVerificationEmail()
            resendState = resendError == nil ? .sent : .idle
        }
    }

    private var signInSection: some View {
        Section {
            let oidc = profile.signIn == "oidc"
            HStack(spacing: 12) {
                Image(systemName: oidc ? "person.badge.key" : "envelope")
                    .settingsIconTile()
                VStack(alignment: .leading, spacing: 1) {
                    Text(oidc ? ProfileText.providerName(profile) : profile.email)
                        .foregroundStyle(PennyColor.label)
                    Text(oidc ? profile.email : "Email and password")
                        .font(.footnote)
                        .foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer(minLength: 0)
                verificationMark
            }
            .cardSettingsRow()
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("profile.signIn")
            if showsUnverified {
                Button {
                    resendVerification()
                } label: {
                    Text(resendState.title)
                        .fontWeight(.semibold)
                        .foregroundStyle(resendState == .idle ? PennyColor.tintText : PennyColor.secondaryLabel)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(resendState != .idle)
                .cardSettingsRow()
                .accessibilityIdentifier("profile.resendVerification")
            }
            if profile.signIn == "password" {
                Button {
                    changingPassword = true
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "key").settingsIconTile()
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Change password").foregroundStyle(PennyColor.label)
                            if let changed = profile.passwordChangedAt {
                                Text("Changed \(ProfileText.changedOn(changed))")
                                    .font(.footnote)
                                    .foregroundStyle(PennyColor.secondaryLabel)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(PennyColor.tertiaryLabel)
                            .accessibilityHidden(true)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .cardSettingsRow()
                .accessibilityIdentifier("profile.changePassword")
            }
        } header: {
            Text("Sign-in").cardSectionHeader()
        } footer: {
            if let resendError {
                Text(resendError).foregroundStyle(PennyColor.danger)
            } else if profile.signIn == "oidc" {
                Text("You sign in to Penny with \(ProfileText.provider(profile)). Your account has no password.")
            }
        }
    }
}

/// The profile screens' words, as on the web.
enum ProfileText {
    /// The provider's configured name, else "your sign-in provider".
    static func provider(_ profile: WireProfile) -> String {
        let name = profile.provider?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "your sign-in provider" : name
    }

    /// The Sign-in row's title for a provider account.
    static func providerName(_ profile: WireProfile) -> String {
        let name = profile.provider?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Single sign-on" : name
    }

    static func nameNote(_ profile: WireProfile) -> String {
        if profile.nameEditable {
            return "People in your households and trips see your name and picture instead of your email."
        }
        let both = !profile.avatarEditable
        let provider = provider(profile)
        let capitalized = provider.prefix(1).uppercased() + provider.dropFirst()
        let place = profile.provider.map { "your \($0) account" } ?? "your provider account"
        return "\(capitalized) manages your name\(both ? " and picture" : ""). Penny updates \(both ? "them" : "it") "
            + "each time you sign in; change \(both ? "them" : "it") in \(place)."
    }

    /// "Oct 3", or "Oct 3, 2025" outside the current year.
    static func changedOn(_ milliseconds: Int64, now: Date = Date(), calendar: Calendar = .current) -> String {
        let date = Date(milliseconds: milliseconds)
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return sameYear
            ? date.formatted(.dateTime.month(.abbreviated).day())
            : date.formatted(.dateTime.month(.abbreviated).day().year())
    }
}

extension View {
    /// A Sign-in row's icon on the cards' neutral 30pt tile.
    func settingsIconTile() -> some View {
        font(.callout)
            .foregroundStyle(PennyColor.label)
            .frame(width: 30, height: 30)
            .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A Your data row: the icon tile (red for Delete account), the title and its detail, and a
/// chevron, as on the profile cards.
private struct DataRow: View {
    let systemImage: String
    let title: String
    let detail: String?
    let destructive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if destructive {
                    Image(systemName: systemImage)
                        .font(.callout)
                        .foregroundStyle(PennyColor.danger)
                        .frame(width: 30, height: 30)
                        .background(
                            PennyColor.danger.opacity(0.14), in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                        )
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: systemImage).settingsIconTile()
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).foregroundStyle(destructive ? PennyColor.danger : PennyColor.label)
                    if let detail {
                        Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .cardSettingsRow()
    }
}

/// "⊘ Verified": a 15pt symbol 6pt before the word, as on the cards.
private struct VerificationLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.subheadline).accessibilityHidden(true)
            configuration.title.font(.body).lineLimit(1)
        }
        .fixedSize()
    }
}
