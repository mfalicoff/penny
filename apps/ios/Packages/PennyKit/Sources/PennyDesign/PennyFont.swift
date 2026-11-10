public import SwiftUI

/// SF Pro through the system text styles, so every size follows Dynamic Type. The design
/// cards use Inter only as a stand-in; the app bundles no fonts (MAZ-132).
public enum PennyFont {
    public static func style(_ scale: TypeScale) -> Font {
        switch scale {
        // Fixed size; views use `HeroAmountFont`, which scales it with Dynamic Type.
        case .hero: .system(size: scale.size, weight: .bold, design: .default).monospacedDigit()
        case .largeTitle: .largeTitle.weight(.bold)
        case .title2: .title2.weight(.bold)
        case .headline: .headline
        case .body: .body
        case .subhead: .subheadline
        case .footnote: .footnote.weight(.semibold)
        }
    }

    /// The text style each scale entry scales with.
    public static func textStyle(_ scale: TypeScale) -> Font.TextStyle {
        switch scale {
        case .hero, .largeTitle: .largeTitle
        case .title2: .title2
        case .headline: .headline
        case .body: .body
        case .subhead: .subheadline
        case .footnote: .footnote
        }
    }
}

/// The 64pt hero amount, scaled with Dynamic Type relative to the large title.
public struct HeroAmountFont: ViewModifier {
    @ScaledMetric(relativeTo: .largeTitle) private var size = TypeScale.hero.size

    public init() {}

    public func body(content: Content) -> some View {
        content.font(.system(size: size, weight: .bold).monospacedDigit())
    }
}
