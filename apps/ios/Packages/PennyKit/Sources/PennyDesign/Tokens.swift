/// Penny's design tokens, copied from contracts/design-baseline.json (`tokens`), which
/// mirrors `--pk-*` in design-kit/src/styles.css. PennyDesignTests fails when the two drift,
/// so change the baseline and this file in the same commit.
///
/// Light and dark only (MAZ-132). The CSS `glass` and `glass-edge` tokens are not here:
/// they approximate Liquid Glass for HTML, and the app uses the real material instead
/// (see `View.pennyGlass`).
nonisolated public struct RGBA: Equatable, Hashable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double
    public let alpha: Double

    public init(_ hex: UInt32, alpha: Double = 1) {
        red = Double((hex >> 16) & 0xFF) / 255
        green = Double((hex >> 8) & 0xFF) / 255
        blue = Double(hex & 0xFF) / 255
        self.alpha = alpha
    }

    public init(red: UInt8, green: UInt8, blue: UInt8, alpha: Double) {
        self.red = Double(red) / 255
        self.green = Double(green) / 255
        self.blue = Double(blue) / 255
        self.alpha = alpha
    }
}

/// A color that follows the system appearance.
nonisolated public struct AdaptiveColor: Equatable, Hashable, Sendable {
    public let light: RGBA
    public let dark: RGBA

    public init(light: RGBA, dark: RGBA) {
        self.light = light
        self.dark = dark
    }

    public init(_ both: RGBA) { self.init(light: both, dark: both) }
}

nonisolated public enum PaletteToken: String, CaseIterable, Sendable {
    case bg, surface, surface2 = "surface-2", fill, separator
    case label, label2 = "label-2", label3 = "label-3"
    case tint, tintText = "tint-text", tintSoft = "tint-soft"
    case income, incomeSoft = "income-soft"
    case invest, investSoft = "invest-soft"
    case pending, pendingSoft = "pending-soft"
    case danger, dangerSoft = "danger-soft"
    case dim

    public var value: AdaptiveColor {
        switch self {
        case .bg: AdaptiveColor(light: RGBA(0xF2F1EE), dark: RGBA(0x000000))
        case .surface: AdaptiveColor(light: RGBA(0xFFFFFF), dark: RGBA(0x1A1918))
        case .surface2: AdaptiveColor(light: RGBA(0xF7F6F3), dark: RGBA(0x232220))
        case .fill:
            AdaptiveColor(
                light: RGBA(red: 120, green: 116, blue: 110, alpha: 0.12),
                dark: RGBA(red: 150, green: 145, blue: 138, alpha: 0.20))
        case .separator:
            AdaptiveColor(
                light: RGBA(red: 60, green: 56, blue: 50, alpha: 0.13),
                dark: RGBA(red: 255, green: 250, blue: 240, alpha: 0.12))
        case .label: AdaptiveColor(light: RGBA(0x16120F), dark: RGBA(0xF6F4F1))
        case .label2: AdaptiveColor(light: RGBA(0x6F6A64), dark: RGBA(0xA39E97))
        case .label3: AdaptiveColor(light: RGBA(0xA9A49D), dark: RGBA(0x6D6863))
        case .tint: AdaptiveColor(light: RGBA(0xE4572E), dark: RGBA(0xFF6F3F))
        case .tintText: AdaptiveColor(light: RGBA(0xC2461F), dark: RGBA(0xFF8A5E))
        case .tintSoft:
            AdaptiveColor(
                light: RGBA(red: 228, green: 87, blue: 46, alpha: 0.12),
                dark: RGBA(red: 255, green: 111, blue: 63, alpha: 0.18))
        case .income: AdaptiveColor(light: RGBA(0x1E8E4E), dark: RGBA(0x3DD07A))
        case .incomeSoft:
            AdaptiveColor(
                light: RGBA(red: 30, green: 142, blue: 78, alpha: 0.12),
                dark: RGBA(red: 61, green: 208, blue: 122, alpha: 0.16))
        case .invest: AdaptiveColor(light: RGBA(0x5B57D1), dark: RGBA(0x8E8BFF))
        case .investSoft:
            AdaptiveColor(
                light: RGBA(red: 91, green: 87, blue: 209, alpha: 0.12),
                dark: RGBA(red: 142, green: 139, blue: 255, alpha: 0.18))
        case .pending: AdaptiveColor(light: RGBA(0xB7791F), dark: RGBA(0xE0A040))
        case .pendingSoft:
            AdaptiveColor(
                light: RGBA(red: 183, green: 121, blue: 31, alpha: 0.13),
                dark: RGBA(red: 224, green: 160, blue: 64, alpha: 0.18))
        case .danger: AdaptiveColor(light: RGBA(0xD93B30), dark: RGBA(0xFF6B60))
        case .dangerSoft:
            AdaptiveColor(
                light: RGBA(red: 217, green: 59, blue: 48, alpha: 0.10),
                dark: RGBA(red: 255, green: 107, blue: 96, alpha: 0.16))
        case .dim:
            AdaptiveColor(
                light: RGBA(red: 20, green: 14, blue: 10, alpha: 0.28),
                dark: RGBA(red: 0, green: 0, blue: 0, alpha: 0.55))
        }
    }
}

/// Category colors never reuse a meaning color (tint, income, invest, pending, danger).
nonisolated public enum CategoryColor: String, CaseIterable, Sendable {
    case home, groceries, transport, food, shopping, entertainment, health, other

    public var value: RGBA {
        switch self {
        case .home: RGBA(0x3B82F6)
        case .groceries: RGBA(0x0FA3A3)
        case .transport: RGBA(0x64748B)
        case .food: RGBA(0xE0529C)
        case .shopping: RGBA(0xA0704C)
        case .entertainment: RGBA(0x7A8F3A)
        case .health: RGBA(0x0E7490)
        case .other: RGBA(0x8E8A85)
        }
    }
}

nonisolated public enum Metrics {
    public static let cardRadius: Double = 26
    public static let rowRadius: Double = 14
    public static let fieldRadius: Double = 12
    public static let gutter: Double = 16
    public static let minTouchTarget: Double = 44
}

/// The baseline type scale as point size and weight at the default Dynamic Type size.
/// SwiftUI uses the matching system text styles (`PennyFont`), which scale with
/// Dynamic Type; these values document and test that mapping.
nonisolated public enum TypeScale: String, CaseIterable, Sendable {
    case hero, largeTitle, title2, headline, body, subhead, footnote

    public var size: Double {
        switch self {
        case .hero: 64
        case .largeTitle: 34
        case .title2: 22
        case .headline, .body: 17
        case .subhead: 15
        case .footnote: 13
        }
    }

    public var weight: Int {
        switch self {
        case .hero, .largeTitle, .title2: 700
        case .headline, .footnote: 600
        case .body, .subhead: 400
        }
    }
}
