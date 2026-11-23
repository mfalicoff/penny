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
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 6)
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, Metrics.gutter)
            }
            .background(PennyColor.surface)
            .navigationTitle("Invite someone")
            .inlineNavigationTitle()
            .toolbar {
                // `iphone-invite`: Done is the copper capsule.
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .buttonStyle(.borderedProminent)
                        .tint(PennyColor.tint)
                        .fontWeight(.semibold)
                        .accessibilityIdentifier("invite.done")
                }
            }
        }
        .presentationBackground(PennyColor.surface)
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

/// The invite code, as the sheet (`iphone-invite`) or the card under People
/// (`iphone-shared-people`) draws it: the code, the time it has left, Copy and Share. The sheet
/// adds the QR code and New code; the card's countdown is amber and its Share is the copper action.
struct InviteCard: View {
    enum Style { case sheet, inline }

    let expiresAt: Date
    let code: InviteCode
    let link: InviteLink
    let renew: () -> Void
    let copy: () -> Void
    var style: Style = .sheet
    @ScaledMetric(relativeTo: .largeTitle) private var sheetCode = 40.0
    @ScaledMetric(relativeTo: .largeTitle) private var inlineCode = 34.0

    var body: some View {
        VStack(spacing: 0) {
            Text("They enter this code in Shared → Join").font(.subheadline)
                .foregroundStyle(PennyColor.secondaryLabel)
                .multilineTextAlignment(.center)
            Text(code.grouped)
                .font(.system(size: style == .sheet ? sheetCode : inlineCode, weight: .bold).monospacedDigit())
                .tracking(style == .sheet ? 1.5 : 4)
                .textSelection(.enabled)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .padding(.top, style == .sheet ? 6 : 4)
                .accessibilityLabel("Invite code \(code.spoken)")
                .accessibilityIdentifier("invite.code")
            if style == .sheet, let image = InviteQRCode.image(for: link.url) {
                Image(image, scale: 1, label: Text("Invite QR code"))
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(18)
                    .frame(width: 212, height: 212)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous)
                            .stroke(PennyColor.separator, lineWidth: 0.5)
                    )
                    .shadow(color: .black.opacity(0.08), radius: 12, y: 8)
                    .padding(.top, 18)
                    .accessibilityLabel("QR code of the invite link. Scanning it opens Penny on the join screen.")
                    .accessibilityAddTraits(.isImage)
                    .accessibilityIdentifier("invite.qr")
            }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let left = expiresAt.timeIntervalSince(context.date)
                Label(left > 0 ? "Expires in \(Self.clock(left))" : "Expired. Make a new code.", systemImage: "clock")
                    .font(style == .sheet ? .subheadline.weight(.medium) : .footnote.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(
                        style == .inline || left <= 60 ? PennyColor.pending : PennyColor.secondaryLabel
                    )
                    .accessibilityLabel(left > 0 ? "Expires in \(Int(left / 60) + 1) minutes" : "Expired")
                    .accessibilityIdentifier("invite.expires")
                // The card under People has no New code until its code has expired.
                if style == .inline, left <= 0 {
                    Button("New code", systemImage: "repeat", action: renew)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(PennyColor.tintText)
                        .frame(minHeight: Metrics.minTouchTarget)
                        .accessibilityIdentifier("invite.new")
                }
            }
            .padding(.top, style == .sheet ? 14 : 4)
            HStack(spacing: 10) {
                Button(action: copy) {
                    Label("Copy", systemImage: "doc.on.doc").inviteButton(style: style, primary: false)
                }
                .buttonStyle(.plain)
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
                    Group {
                        if style == .sheet {
                            HStack(spacing: 7) {
                                Text("Share")
                                Image(systemName: "chevron.down").font(.footnote.weight(.semibold))
                                    .foregroundStyle(PennyColor.secondaryLabel)
                            }
                        } else {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }
                    .inviteButton(style: style, primary: style == .inline)
                }
                .accessibilityIdentifier("invite.share")
            }
            .padding(.top, style == .sheet ? 22 : 14)
            if style == .sheet {
                Button(action: renew) {
                    Label("New code", systemImage: "repeat").font(.body.weight(.semibold))
                }
                .foregroundStyle(PennyColor.tintText)
                .frame(minHeight: Metrics.minTouchTarget)
                .padding(.top, 4)
                .accessibilityHint("Replaces this code. The old one stops working.")
                .accessibilityIdentifier("invite.new")
            }
        }
        .frame(maxWidth: .infinity)
    }

    static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded(.up))
        let rest = total % 60
        return "\(total / 60):\(rest < 10 ? "0" : "")\(rest)"
    }
}

extension View {
    /// The invite's Copy and Share: equal capsules on the fill color, or copper for the card's Share.
    fileprivate func inviteButton(style: InviteCard.Style, primary: Bool) -> some View {
        font((style == .sheet ? Font.body : .subheadline).weight(.semibold))
            .foregroundStyle(primary ? Color.white : PennyColor.label)
            .frame(maxWidth: .infinity, minHeight: style == .sheet ? 50 : Metrics.minTouchTarget)
            .background(primary ? PennyColor.tint : PennyColor.fill, in: Capsule())
            .contentShape(Capsule())
    }
}
