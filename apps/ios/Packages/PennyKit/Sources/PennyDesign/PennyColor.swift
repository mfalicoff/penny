public import SwiftUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

extension RGBA {
    var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
}

extension AdaptiveColor {
    /// A SwiftUI color that resolves `light` or `dark` from the current appearance.
    public var color: Color {
        #if canImport(UIKit)
            Color(
                uiColor: UIColor { traits in
                    let value = traits.userInterfaceStyle == .dark ? dark : light
                    return UIColor(red: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
                })
        #elseif canImport(AppKit)
            Color(
                nsColor: NSColor(name: nil) { appearance in
                    let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                    let value = isDark ? dark : light
                    return NSColor(srgbRed: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
                })
        #endif
    }
}

/// Semantic colors for views. Prefer these over raw tokens: each has one meaning.
public enum PennyColor {
    public static let background = PaletteToken.bg.value.color
    public static let surface = PaletteToken.surface.value.color
    public static let secondarySurface = PaletteToken.surface2.value.color
    public static let fill = PaletteToken.fill.value.color
    public static let separator = PaletteToken.separator.value.color

    public static let label = PaletteToken.label.value.color
    public static let secondaryLabel = PaletteToken.label2.value.color
    public static let tertiaryLabel = PaletteToken.label3.value.color

    /// The only brand and action tint (copper). Also the app's accent color.
    public static let tint = PaletteToken.tint.value.color
    /// Copper for small text, with enough contrast on light surfaces.
    public static let tintText = PaletteToken.tintText.value.color
    public static let income = PaletteToken.income.value.color
    public static let invest = PaletteToken.invest.value.color
    public static let pending = PaletteToken.pending.value.color
    /// Errors and destructive actions only. Expenses use `label`, never red.
    public static let danger = PaletteToken.danger.value.color
    public static let expense = label

    public static func category(_ category: CategoryColor) -> Color { category.value.color }
}
