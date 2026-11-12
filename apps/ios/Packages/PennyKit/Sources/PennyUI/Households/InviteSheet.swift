import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

#if os(iOS)
    import UIKit
#endif

/// The invite (`iphone-shared-people` invite card, the redesign's `invite`): the code as text and
/// as a QR code, the time it has left and New code. One code works for several people until it
/// expires (10 minutes) or is replaced. The QR code is the `penny://join` link with this server,
/// made with Core Image; the share sheet sends the code, the link or the QR image.
struct InviteSheet: View {
    @Bindable var model: HouseholdModel
    @Environment(\.dismiss) private var dismiss
    @State private var working = false
    @State private var failure: HouseholdFailure?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if let failure {
                        HouseholdFailureBanner(failure: failure) { Task { await create() } }
                    }
                    if let invite = model.invite, let code = InviteCode(typed: invite.code) {
                        InviteCard(
                            expiresAt: model.inviteExpiresAt ?? Date(milliseconds: invite.expiresAt), code: code,
                            link: InviteLink(code: code, server: serverURL)
                        ) {
                            Task { await create() }
                        } copy: {
                            copy(code.value)
                        }
                    } else if working {
                        PennyStateView(.loading, title: "Creating a code…")
                    }
                    Text(
                        "They open Shared, tap Join with a code, and type or scan it. Everyone uses "
                            + "\(model.currency); new members are included in equal splits from the day they join."
                    )
                    .font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .padding(Metrics.gutter)
            }
            .background(PennyColor.background)
            .navigationTitle("Invite someone")
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            model.expireInvite()
            if model.invite == nil { await create() }
        }
        .accessibilityIdentifier("screen.invite")
    }

    /// The signed-in server, which the link names so a scan opens the right one.
    @Environment(ShellModel.self) private var shell
    private var serverURL: ServerURL? { shell.account?.server }

    private func create() async {
        working = true
        defer { working = false }
        failure = await model.newInvite()
    }

    private func copy(_ text: String) {
        #if os(iOS)
            UIPasteboard.general.string = text
        #endif
        copied = true
    }
}

private struct InviteCard: View {
    let expiresAt: Date
    let code: InviteCode
    let link: InviteLink
    let renew: () -> Void
    let copy: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("They enter this code in Shared → Join").font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
            Text(code.grouped)
                .font(.largeTitle.weight(.bold).monospaced())
                .textSelection(.enabled)
                .accessibilityLabel("Invite code \(code.spoken)")
                .accessibilityIdentifier("invite.code")
            if let image = InviteQRCode.image(for: link.url) {
                Image(image, scale: 1, label: Text("Invite QR code"))
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 220)
                    .padding(12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: Metrics.rowRadius))
                    .accessibilityLabel("QR code of the invite link. Scanning it opens Penny on the join screen.")
                    .accessibilityAddTraits(.isImage)
                    .accessibilityIdentifier("invite.qr")
            }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let left = expiresAt.timeIntervalSince(context.date)
                Text(left > 0 ? "Expires in \(Self.clock(left))" : "Expired. Make a new code.")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(left > 60 ? PennyColor.secondaryLabel : PennyColor.pending)
                    .accessibilityLabel(left > 0 ? "Expires in \(Int(left / 60) + 1) minutes" : "Expired")
                    .accessibilityIdentifier("invite.expires")
            }
            HStack(spacing: 12) {
                PennyButton("Copy", systemImage: "doc.on.doc", role: .secondary, action: copy)
                    .accessibilityIdentifier("invite.copy")
                Menu {
                    ShareLink(item: "Join my household in Penny with code \(code.grouped)") {
                        Label("Share code", systemImage: "textformat")
                    }
                    ShareLink(item: link.url) { Label("Share link", systemImage: "link") }
                    if let image = InviteQRCode.image(for: link.url, scale: 12) {
                        let qr = Image(decorative: image, scale: 1)
                        ShareLink(item: qr, preview: SharePreview("Penny invite QR code", image: qr)) {
                            Label("Share QR image", systemImage: "qrcode")
                        }
                    }
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: ControlSize.button)
                        .background(PennyColor.tint, in: Capsule())
                        .foregroundStyle(.white)
                }
                .accessibilityIdentifier("invite.share")
            }
            Button("New code", systemImage: "arrow.clockwise", action: renew)
                .accessibilityHint("Replaces this code. The old one stops working.")
                .accessibilityIdentifier("invite.new")
        }
        .pennyCard()
    }

    static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded(.up))
        let rest = total % 60
        return "\(total / 60):\(rest < 10 ? "0" : "")\(rest)"
    }
}
