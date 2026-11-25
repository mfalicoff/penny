import PennyData
import PennyDesign
import PennyDomain
import SwiftUI

/// The leaf mark at the top of sign-in (`sign-in` card): a copper tile with a soft copper shadow.
struct BrandHeader: View {
    @ScaledMetric private var size: Double

    /// 64 pt on the sign-in cards, 56 pt when the providers lead (`iphone-sign-in-providers`).
    init(size: Double = 64) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: .largeTitle)
    }

    var body: some View {
        Image(systemName: "leaf")
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(PennyColor.tint, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .shadow(color: PennyColor.tint.opacity(0.35), radius: 15, y: 10)
            .accessibilityElement()
            .accessibilityLabel("Penny")
            .accessibilityAddTraits(.isImage)
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
                Image(systemName: "server.rack")
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

/// The cards' grouped fields (`.fields`): one solid card whose rows carry their label inside,
/// with an inset separator between rows. Put `AuthFieldRow`s in it.
struct AuthFieldGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { rows in
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Rectangle()
                            .fill(PennyColor.separator)
                            .frame(height: 0.5)
                            .padding(.leading, 16)
                    }
                    row
                }
            }
        }
        .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// One row of `AuthFieldGroup` (`.f`): a small semibold label over the field, and an optional
/// trailing control such as a clear button.
struct AuthFieldRow<Field: View, Trailing: View>: View {
    let label: String
    @ViewBuilder let field: Field
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(PennyColor.secondaryLabel)
                    .accessibilityHidden(true)
                field
                    .font(PennyFont.style(.body))
                    .foregroundStyle(PennyColor.label)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(minHeight: Metrics.minTouchTarget + 14)
    }
}

extension AuthFieldRow where Trailing == EmptyView {
    init(label: String, @ViewBuilder field: () -> Field) {
        self.init(label: label, field: field) { EmptyView() }
    }
}

/// "New here? **Create an account**": the question in the secondary label color and the
/// action in bold copper (`.link`).
struct AuthLink: View {
    let lead: String
    let action: String
    let perform: () -> Void

    var body: some View {
        Button(action: perform) {
            Text(
                "\(Text(lead).foregroundStyle(PennyColor.secondaryLabel)) \(Text(action).fontWeight(.semibold).foregroundStyle(PennyColor.tintText))"
            )
            .font(PennyFont.style(.subhead))
            .multilineTextAlignment(.center)
            .frame(minHeight: Metrics.minTouchTarget)
        }
        .buttonStyle(.plain)
    }
}

/// The create-account password meter (`.meter`, four bars) and its length rule (`.hint`).
struct PasswordStrengthView: View {
    let password: String

    var body: some View {
        let score = PasswordStrength.score(password)
        let long = PasswordStrength.meetsLength(password)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                ForEach(0..<PasswordStrength.maximum, id: \.self) { index in
                    Capsule()
                        .fill(index < score ? PennyColor.label : PennyColor.fill)
                        .frame(height: 4)
                }
            }
            .padding(.top, 10)
            .accessibilityElement()
            .accessibilityLabel("Password strength")
            .accessibilityValue("\(score) of \(PasswordStrength.maximum)")
            Label {
                Text("At least \(PasswordStrength.minimumLength) characters")
            } icon: {
                Image(systemName: long ? "checkmark" : "circle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(long ? PennyColor.secondaryLabel : PennyColor.tertiaryLabel)
            }
            .labelStyle(.titleAndIcon)
            .font(.footnote)
            .foregroundStyle(PennyColor.secondaryLabel)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("At least \(PasswordStrength.minimumLength) characters")
            .accessibilityValue(long ? "Met" : "Not met")
            .accessibilityIdentifier("auth.passwordRule")
        }
        .padding(.horizontal, 4)
        .accessibilityIdentifier("auth.passwordStrength")
    }
}

/// How strong a new password looks, for the meter only: the server enforces the real rule
/// (at least 10 characters).
nonisolated enum PasswordStrength {
    static let minimumLength = 10
    static let maximum = 4

    static func meetsLength(_ password: String) -> Bool { password.count >= minimumLength }

    /// 0 for nothing typed; 1 while shorter than the minimum; otherwise one bar each for the
    /// minimum length, 14 or more characters, letters with digits, and a symbol or mixed case.
    static func score(_ password: String) -> Int {
        guard !password.isEmpty else { return 0 }
        guard meetsLength(password) else { return 1 }
        let letters = password.contains(where: \.isLetter)
        let digits = password.contains(where: \.isNumber)
        let symbols = password.contains { !$0.isLetter && !$0.isNumber && !$0.isWhitespace }
        let mixedCase = password.contains(where: \.isUppercase) && password.contains(where: \.isLowercase)
        return 1 + (password.count >= 14 ? 1 : 0) + (letters && digits ? 1 : 0) + (symbols || mixedCase ? 1 : 0)
    }
}

/// The "or" between Sign in and single sign-on, with a hairline on each side (`.or`).
struct OrDivider: View {
    /// "or" between the form and a lone single sign-on; "or use your email" when the providers
    /// lead (MAZ-170, `iphone-sign-in-providers`), in the secondary label color the card gives it.
    var text = "or"

    var body: some View {
        HStack(spacing: 12) {
            line
            Text(text).font(.footnote)
                .foregroundStyle(text == "or" ? PennyColor.tertiaryLabel : PennyColor.secondaryLabel)
                .fixedSize()
            line
        }
        .accessibilityHidden(true)
    }

    private var line: some View {
        Rectangle().fill(PennyColor.separator).frame(height: 0.5)
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
