import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// Invite someone: by email while the server sends email (MAZ-124, `iphone-invite-email`), with
/// "Share a code instead" for the shared code (`iphone-invite`); only the code otherwise. Reads
/// `/api/info` again on open, so a server that turned email on or off shows the right sheet.
struct InviteEntrySheet: View {
    @Bindable var model: HouseholdModel
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sharesCode = false

    private var emailEnabled: Bool { shell.auth?.server?.emailEnabled == true }

    var body: some View {
        Group {
            if emailEnabled, !sharesCode {
                InviteEmailSheet(model: model, service: model.service) {
                    withAnimation(Motion.animation(.standard, reduceMotion: reduceMotion)) { sharesCode = true }
                } emailOff: {
                    Task { await shell.auth?.refreshServerInfo() }
                }
            } else {
                InviteSheet(model: model)
            }
        }
        .task { await shell.auth?.refreshServerInfo() }
    }
}

/// Invite by email (card `iphone-invite-email`): an address and Send, what Penny does with it,
/// then the invitations already sent with their status and a … menu (Resend, Cancel invite), and
/// "Share a code instead". Only the creator invites, as with codes; the server says so (403)
/// otherwise. Joining still asks the invitee to accept, with the existing join screen.
struct InviteEmailSheet: View {
    let model: HouseholdModel
    let shareCode: () -> Void
    let emailOff: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(ShellModel.self) private var shell
    @State private var invites: EmailInvitesModel
    @State private var address = ""
    @State private var failure: HouseholdFailure?
    @FocusState private var focused: Bool

    init(
        model: HouseholdModel, service: any HouseholdService, shareCode: @escaping () -> Void,
        emailOff: @escaping () -> Void
    ) {
        self.model = model
        self.shareCode = shareCode
        self.emailOff = emailOff
        _invites = State(initialValue: EmailInvitesModel(householdId: model.id, service: service))
    }

    private var groupName: String { model.household?.name ?? "this household" }
    private var host: String { shell.account.map { ServerText.host($0.server) } ?? "this server" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Send an invite").cardSectionHeader().padding(.horizontal, 16)
                    sendRow.padding(.top, 10)
                    Text(
                        "Penny emails them a link to join. If they are new to Penny, the link lets them create an "
                            + "account on \(host) first. Joining still asks them to accept."
                    )
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    if let failure {
                        HouseholdFailureBanner(failure: failure)
                            .padding(.top, 14)
                            .accessibilityIdentifier("inviteEmail.error")
                    }
                    invited.padding(.top, 26)
                    shareCodeRow.padding(.top, 22)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, Metrics.gutter)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(PennyColor.background)
            .navigationTitle("Invite to \(groupName)")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .neutralToolbarGlyph()
                        .accessibilityIdentifier("inviteEmail.close")
                }
            }
            .pennySolidBars()
        }
        .presentationBackground(PennyColor.background)
        .task { await invites.refresh() }
        .onChange(of: invites.emailOff) { if invites.emailOff { emailOff() } }
        .accessibilityIdentifier("screen.inviteEmail")
    }

    /// The address on a solid capsule, and Send, the copper action.
    private var sendRow: some View {
        HStack(spacing: 10) {
            TextField("Email", text: $address, prompt: Text(verbatim: "name@example.com"))
                .emailEntry()
                .textContentType(.emailAddress)
                .submitLabel(.send)
                .focused($focused)
                .onSubmit(send)
                .font(PennyFont.style(.body))
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .accessibilityIdentifier("inviteEmail.address")
            Button(action: send) {
                HStack(spacing: 6) {
                    if invites.sending { ProgressView().tint(.white) }
                    Text(invites.sending ? "Sending…" : "Send")
                }
                .font(PennyFont.style(.headline))
                .foregroundStyle(.white)
                .padding(.horizontal, 22)
                .frame(minHeight: 52)
                .background(PennyColor.tint, in: Capsule())
                .shadow(color: PennyColor.tint.opacity(0.3), radius: 10, y: 6)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(invites.sending)
            .accessibilityIdentifier("inviteEmail.send")
        }
    }

    private var invited: some View {
        VStack(alignment: .leading, spacing: 0) { invitedContent }
    }

    @ViewBuilder
    private var invitedContent: some View {
        Text("Invited").cardSectionHeader().padding(.horizontal, 16)
        Group {
            switch invites.load {
            case .idle, .loading:
                ProgressView("Loading invitations…")
                    .frame(maxWidth: .infinity)
                    .pennyCard()
            case .failed(let failure) where invites.invites.isEmpty:
                HouseholdFailureBanner(failure: failure) { Task { await invites.refresh() } }
            case .failed, .loaded:
                if invites.invites.isEmpty {
                    Text("Nobody yet. Invitations you send show here until they're used or cancelled.")
                        .font(.subheadline)
                        .foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                        .pennyCard()
                        .accessibilityIdentifier("inviteEmail.empty")
                } else {
                    list
                }
            }
        }
        .padding(.top, 10)
        if !invites.invites.isEmpty {
            Text("Resend or cancel an invite from its menu.")
                .font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .padding(.horizontal, 16)
                .padding(.top, 12)
        }
    }

    private var list: some View {
        VStack(spacing: 0) {
            ForEach(Array(invites.invites.enumerated()), id: \.element.id) { index, invite in
                if index > 0 {
                    Rectangle().fill(PennyColor.separator).frame(height: 0.5).padding(.leading, 60)
                }
                InviteEmailRow(
                    invite: invite, now: shell.now(), working: invites.working.contains(invite.id),
                    resend: { Task { await act { await invites.resend(invite) } } },
                    cancel: { Task { await act { await invites.revoke(invite) } } })
            }
        }
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
    }

    /// "Share a code instead · For someone next to you": the `iphone-invite` code sheet.
    private var shareCodeRow: some View {
        Button(action: shareCode) {
            HStack(spacing: 14) {
                Image(systemName: "key")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(PennyColor.label)
                    .frame(width: 36, height: 36)
                    .background(PennyColor.fill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Share a code instead").font(PennyFont.style(.body)).foregroundStyle(PennyColor.label)
                    Text("For someone next to you").font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(PennyColor.tertiaryLabel)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("inviteEmail.shareCode")
    }

    private func send() {
        guard !invites.sending else { return }
        failure = nil
        let to = address
        Task {
            switch await invites.send(to: to) {
            case .success(let invite):
                address = ""
                AccessibilityNotification.Announcement("Invitation sent to \(invite.email).").post()
            case .failure(let failure):
                self.failure = failure
                if failure.kind == .invalid { focused = true }
            }
        }
    }

    private func act(_ work: () async -> HouseholdFailure?) async {
        failure = nil
        failure = await work()
    }
}

/// One invitation (`iphone-invite-email`): the envelope on a neutral disc, the address and when it
/// was sent, the status in words with its tint, and a … menu with Resend and Cancel invite.
private struct InviteEmailRow: View {
    let invite: WireEmailInvite
    let now: Date
    let working: Bool
    let resend: () -> Void
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "envelope")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PennyColor.secondaryLabel)
                .frame(width: 32, height: 32)
                .background(PennyColor.fill, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(invite.email)
                    .font(PennyFont.style(.body))
                    .foregroundStyle(PennyColor.label)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(EmailInviteText.detail(invite, now: now))
                    .font(.subheadline)
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            HouseholdTag(
                text: EmailInviteText.status(invite.status), systemImage: Self.symbol(invite.status),
                tone: Self.tone(invite.status))
            if working {
                ProgressView().frame(width: Metrics.minTouchTarget, height: Metrics.minTouchTarget)
            } else {
                Menu {
                    if invite.status != .joined {
                        Button("Resend", systemImage: "arrow.clockwise", action: resend)
                            .disabled(invite.status == .sending)
                    }
                    Button("Cancel invite", systemImage: "xmark.circle", role: .destructive, action: cancel)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(PennyColor.label)
                        .frame(width: 30, height: 30)
                        .background(PennyColor.fill, in: Circle())
                        .frame(minWidth: Metrics.minTouchTarget, minHeight: Metrics.minTouchTarget)
                        .contentShape(Circle())
                }
                .accessibilityLabel("More for \(invite.email)")
                .accessibilityIdentifier("inviteEmail.more.\(invite.id)")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("inviteEmail.row.\(invite.id)")
    }

    /// Words first; the glyph repeats them for sending, joined and failed, as on the web.
    static func symbol(_ status: WireEmailInvite.Status) -> String? {
        switch status {
        case .sending: "clock"
        case .joined: "checkmark"
        case .failed: "exclamationmark.circle"
        case .waiting, .expired: nil
        }
    }

    static func tone(_ status: WireEmailInvite.Status) -> HouseholdTag.Tone {
        switch status {
        case .waiting: .pending
        case .joined: .income
        case .failed: .danger
        case .sending, .expired: .neutral
        }
    }
}
