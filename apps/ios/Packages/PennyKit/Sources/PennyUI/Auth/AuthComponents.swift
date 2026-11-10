import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The leaf mark and wordmark at the top of the signed-out screens.
struct BrandHeader: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "leaf")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 60, height: 60)
                .background(PennyColor.tint, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                .accessibilityHidden(true)
            Text("penny.")
                .font(PennyFont.style(.largeTitle))
                .foregroundStyle(PennyColor.label)
                .accessibilityLabel("Penny")
        }
    }
}

/// The server the signed-out screens talk to, with an optional "Change" action.
struct ServerChip: View {
    let server: SavedServer?
    var onChange: (() -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            // The server is one element and the button another, so VoiceOver reads the
            // server and can still reach and activate "Change".
            HStack(spacing: 8) {
                Image(systemName: server?.server.url.scheme == "https" ? "lock.fill" : "server.rack")
                    .foregroundStyle(PennyColor.secondaryLabel)
                Text(server.map { ServerText.host($0.server) } ?? "No server chosen")
                    .font(PennyFont.style(.subhead))
                    .foregroundStyle(PennyColor.label)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.label(server))
            .accessibilityIdentifier("auth.server")
            if let onChange {
                Button(server == nil ? "Choose" : "Change", action: onChange)
                    .font(PennyFont.style(.subhead).weight(.semibold))
                    .accessibilityIdentifier("auth.changeServer")
                    .accessibilityHint("Choose another Penny server")
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: Metrics.minTouchTarget)
        .pennyGlass()
        .accessibilityElement(children: .contain)
    }

    static func label(_ server: SavedServer?) -> String {
        server.map { "Server \(ServerText.host($0.server))" } ?? "No server chosen"
    }
}

/// A labeled text field on a solid surface.
struct AuthField<Field: View>: View {
    let label: String
    var footnote: String?
    @ViewBuilder let field: Field

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(PennyFont.style(.footnote))
                .foregroundStyle(PennyColor.secondaryLabel)
                .accessibilityHidden(true)
            field
                .font(PennyFont.style(.body))
                .padding(.horizontal, 14)
                .frame(minHeight: Metrics.minTouchTarget + 4)
                .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.fieldRadius))
                .overlay(RoundedRectangle(cornerRadius: Metrics.fieldRadius).stroke(PennyColor.separator))
            if let footnote {
                Text(footnote)
                    .font(PennyFont.style(.footnote))
                    .foregroundStyle(PennyColor.secondaryLabel)
            }
        }
    }
}

/// An inline failure or notice. Announced to VoiceOver when it appears.
struct AuthMessage: View {
    enum Tone { case error, notice }

    let text: String
    var tone: Tone = .error

    var body: some View {
        Label {
            Text(text).font(PennyFont.style(.subhead))
        } icon: {
            Image(systemName: tone == .error ? "exclamationmark.triangle.fill" : "info.circle.fill")
        }
        .foregroundStyle(tone == .error ? PennyColor.danger : PennyColor.secondaryLabel)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(tone == .error ? "auth.error" : "auth.notice")
        .onAppear { AccessibilityNotification.Announcement(text).post() }
    }
}

/// The full-width copper action button.
struct PrimaryButton: View {
    let title: String
    var busy = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(.white) }
                Text(title).font(PennyFont.style(.headline))
            }
            .frame(maxWidth: .infinity, minHeight: Metrics.minTouchTarget + 6)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .tint(PennyColor.tint)
    }
}

nonisolated enum ServerText {
    /// "penny.example.com", with a non-default port, for display.
    static func host(_ server: ServerURL) -> String {
        let host = server.url.host ?? server.description
        return server.url.port.map { "\(host):\($0)" } ?? host
    }
}
