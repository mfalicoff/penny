import PennyData
import PennyDesign
import SwiftUI

/// The marks on the sign-in provider buttons and the profile's Sign-in row (MAZ-170; cards
/// `iphone-sign-in-providers`, `iphone-create-account-providers`, `iphone-profile-provider`):
/// Apple's and Google's own logos, drawn from the cards' paths, and the generic key for any other
/// provider (the server's own single sign-on).
struct ProviderMark: View {
    let mark: SignInProvider.Mark
    var size: Double = 19

    var body: some View {
        Group {
            switch mark {
            case .apple:
                SVGShape(viewBox: 24, paths: [Self.apple]).fill(.foreground)
            case .google:
                ZStack {
                    ForEach(Self.google.indices, id: \.self) { index in
                        SVGShape(viewBox: 48, paths: [Self.google[index].path]).fill(Self.google[index].color)
                    }
                }
            case .other:
                Image(systemName: "key").font(.system(size: size * 0.9, weight: .medium))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    /// The Apple logo in a 24-unit box (the cards' `.pb.apple` mark).
    static let apple =
        "M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.9-3.75 2.27-1.6 2.78-.41 6.89 1.15 9.14.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.39-.92-2.4-3.66zM14.1 5.86c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.27z"

    /// Google's four-color G in a 48-unit box (the cards' `.pb.google` mark), in Google's colors.
    static let google: [(path: String, color: Color)] = [
        (
            "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z",
            Color(.sRGB, red: 0xEA / 255, green: 0x43 / 255, blue: 0x35 / 255)
        ),
        (
            "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z",
            Color(.sRGB, red: 0x42 / 255, green: 0x85 / 255, blue: 0xF4 / 255)
        ),
        (
            "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z",
            Color(.sRGB, red: 0xFB / 255, green: 0xBC / 255, blue: 0x05 / 255)
        ),
        (
            "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z",
            Color(.sRGB, red: 0x34 / 255, green: 0xA8 / 255, blue: 0x53 / 255)
        ),
    ]
}

/// The words on a provider's button, as on the web: Apple and Google say "Sign in with" and
/// "Sign up with", as their button rules ask. The server's own single sign-on says "Continue with
/// SSO" when it is the only one (`iphone-sign-in`, `iphone-sign-in-providers`), and names itself
/// when there are several, so they can be told apart.
enum ProviderText {
    static func action(_ provider: SignInProvider, creating: Bool, among providers: [SignInProvider]) -> String {
        if provider.isBrand { return "\(creating ? "Sign up" : "Sign in") with \(provider.label)" }
        let others = providers.filter { !$0.isBrand }
        return others.count > 1 ? "Continue with \(provider.label)" : "Continue with SSO"
    }

    /// What VoiceOver hears: the button's words, and the provider's name when they hide it.
    static func accessibilityLabel(_ provider: SignInProvider, creating: Bool, among providers: [SignInProvider])
        -> String
    {
        let action = action(provider, creating: creating, among: providers)
        return action.hasSuffix(provider.label) ? action : "\(action), \(provider.label)"
    }

    /// Providers lead, above "or use your email", when Apple or Google is among them
    /// (`iphone-sign-in-providers`); a lone single sign-on follows the form (`iphone-sign-in`).
    static func leads(_ providers: [SignInProvider]) -> Bool { providers.contains(where: \.isBrand) }
}

/// One sign-in button per provider the server lists, in its order (MAZ-170). Apple's is solid
/// black (white in dark mode), Google's white with its grey outline (dark grey in dark mode), as
/// their button rules and the cards draw them; single sign-on is the cards' neutral glass capsule.
struct ProviderButtons: View {
    let providers: [SignInProvider]
    let creating: Bool
    /// The provider whose sign-in is open, for its "Waiting for …" state.
    let waiting: SignInProvider.ID?
    let disabled: Bool
    let start: (SignInProvider) -> Void

    var body: some View {
        VStack(spacing: 10) {
            ForEach(providers) { provider in
                ProviderButton(
                    provider: provider,
                    title: waiting == provider.id
                        ? "Waiting for \(provider.label)…"
                        : ProviderText.action(provider, creating: creating, among: providers),
                    accessibilityLabel: waiting == provider.id
                        ? "Waiting for \(provider.label)"
                        : ProviderText.accessibilityLabel(provider, creating: creating, among: providers),
                    waiting: waiting == provider.id
                ) { start(provider) }
                .disabled(disabled)
                .accessibilityIdentifier("auth.provider.\(provider.id)")
            }
        }
    }
}

private struct ProviderButton: View {
    let provider: SignInProvider
    let title: String
    let accessibilityLabel: String
    let waiting: Bool
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .headline) private var height = 50.0
    @ScaledMetric(relativeTo: .headline) private var markSize = 19.0

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if waiting {
                    ProgressView().tint(foreground)
                } else {
                    ProviderMark(mark: provider.mark, size: markSize)
                }
                Text(title).lineLimit(2).multilineTextAlignment(.center)
            }
            .font(PennyFont.style(.headline))
            .foregroundStyle(foreground)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: max(height, Metrics.minTouchTarget))
            .background { background }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var dark: Bool { colorScheme == .dark }

    private var foreground: Color {
        switch provider.mark {
        case .apple: dark ? .black : .white
        case .google: dark ? Brand.googleDarkText : Brand.googleLightText
        case .other: PennyColor.label
        }
    }

    @ViewBuilder
    private var background: some View {
        switch provider.mark {
        case .apple:
            Capsule().fill(dark ? Color.white : Color.black)
        case .google:
            Capsule()
                .fill(dark ? Brand.googleDarkFill : Color.white)
                .overlay(Capsule().strokeBorder(dark ? Brand.googleDarkStroke : Brand.googleLightStroke, lineWidth: 1))
        case .other:
            Color.clear.pennyGlass(in: Capsule())
        }
    }

    /// Google's button colors from its sign-in branding rules (the cards' `.pb.google`). These are
    /// Google's, not Penny tokens.
    private enum Brand {
        static let googleLightText = Color(.sRGB, red: 0x1F / 255, green: 0x1F / 255, blue: 0x1F / 255)
        static let googleLightStroke = Color(.sRGB, red: 0x74 / 255, green: 0x77 / 255, blue: 0x75 / 255)
        static let googleDarkText = Color(.sRGB, red: 0xE3 / 255, green: 0xE3 / 255, blue: 0xE3 / 255)
        static let googleDarkFill = Color(.sRGB, red: 0x13 / 255, green: 0x13 / 255, blue: 0x14 / 255)
        static let googleDarkStroke = Color(.sRGB, red: 0x8E / 255, green: 0x91 / 255, blue: 0x8F / 255)
    }
}

/// A shape from SVG path data in a square `viewBox`, scaled to fit its frame. Reads the commands
/// the provider marks use: M, L, H, V, C, S and Z, absolute and relative, with implicit repeats.
nonisolated struct SVGShape: Shape {
    let viewBox: Double
    let paths: [String]

    func path(in rect: CGRect) -> Path {
        var result = Path()
        for data in paths { result.addPath(Self.parse(data)) }
        let scale = min(rect.width, rect.height) / viewBox
        return result.applying(
            CGAffineTransform(scaleX: scale, y: scale)
                .concatenating(
                    CGAffineTransform(
                        translationX: rect.minX + (rect.width - viewBox * scale) / 2,
                        y: rect.minY + (rect.height - viewBox * scale) / 2)))
    }

    enum Token: Equatable {
        case command(Character)
        case number(Double)
    }

    static func tokens(_ data: String) -> [Token] {
        var tokens: [Token] = []
        var number = ""
        var hasDot = false
        var hasExponent = false
        func flush() {
            if let value = Double(number) { tokens.append(.number(value)) }
            number = ""
            hasDot = false
            hasExponent = false
        }
        for character in data {
            switch character {
            case "0"..."9":
                number.append(character)
            case ".":
                if hasDot || hasExponent { flush() }
                hasDot = true
                number.append(character)
            case "-", "+":
                if let last = number.last, last == "e" || last == "E" {
                    number.append(character)
                } else {
                    flush()
                    number.append(character)
                }
            case "e", "E":
                hasExponent = true
                number.append(character)
            case _ where character.isLetter:
                flush()
                tokens.append(.command(character))
            default:
                flush()
            }
        }
        flush()
        return tokens
    }

    static func parse(_ data: String) -> Path {
        var path = Path()
        var current = CGPoint.zero
        var start = CGPoint.zero
        var lastControl: CGPoint?
        var command: Character = "M"
        var index = 0
        let tokens = tokens(data)

        func take(_ count: Int) -> [Double]? {
            var values: [Double] = []
            while values.count < count, index < tokens.count, case .number(let value) = tokens[index] {
                values.append(value)
                index += 1
            }
            return values.count == count ? values : nil
        }

        while index < tokens.count {
            if case .command(let next) = tokens[index] {
                command = next
                index += 1
                if next == "Z" || next == "z" {
                    path.closeSubpath()
                    current = start
                    lastControl = nil
                    continue
                }
            }
            let relative = command.isLowercase
            let base = relative ? current : .zero
            func point(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: base.x + x, y: base.y + y) }
            switch command.uppercased() {
            case "M":
                guard let values = take(2) else { return path }
                current = point(values[0], values[1])
                start = current
                path.move(to: current)
                lastControl = nil
                command = relative ? "l" : "L"
            case "L":
                guard let values = take(2) else { return path }
                current = point(values[0], values[1])
                path.addLine(to: current)
                lastControl = nil
            case "H":
                guard let values = take(1) else { return path }
                current = CGPoint(x: (relative ? current.x : 0) + values[0], y: current.y)
                path.addLine(to: current)
                lastControl = nil
            case "V":
                guard let values = take(1) else { return path }
                current = CGPoint(x: current.x, y: (relative ? current.y : 0) + values[0])
                path.addLine(to: current)
                lastControl = nil
            case "C":
                guard let values = take(6) else { return path }
                let control1 = point(values[0], values[1])
                let control2 = point(values[2], values[3])
                current = point(values[4], values[5])
                path.addCurve(to: current, control1: control1, control2: control2)
                lastControl = control2
            case "S":
                guard let values = take(4) else { return path }
                let control1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let control2 = point(values[0], values[1])
                current = point(values[2], values[3])
                path.addCurve(to: current, control1: control1, control2: control2)
                lastControl = control2
            default:
                return path
            }
        }
        return path
    }
}
