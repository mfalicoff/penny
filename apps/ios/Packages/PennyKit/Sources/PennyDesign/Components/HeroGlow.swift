public import SwiftUI

/// The tinted glow behind a screen's hero (design-kit `--pk-glow-copper`, the cards' `.glow`):
/// three soft copper, amber and rose blobs, blurred, behind Home's Left to spend and the
/// create-account header (MAZ-180). It is decoration only: hidden from VoiceOver, never
/// hit-tested, and left out with Increase Contrast, so text sits on the plain background.
public struct HeroGlow: View {
    @Environment(\.colorSchemeContrast) private var contrast
    private let opacity: Double
    private let blur: CGFloat

    /// `opacity` dims the whole glow (the empty Home draws it at 0.6); a small glow, such as
    /// Appearance's previews, takes a smaller `blur`.
    public init(opacity: Double = 1, blur: CGFloat = GlowBlob.blur) {
        self.opacity = opacity
        self.blur = blur
    }

    public var body: some View {
        if contrast != .increased {
            GeometryReader { proxy in
                let size = proxy.size
                ZStack {
                    ForEach(Array(GlowBlob.copper.enumerated()), id: \.offset) { _, blob in
                        // CSS `radial-gradient(rx ry at x y, color, transparent 70%)`.
                        EllipticalGradient(
                            colors: [blob.color.color, blob.color.color.opacity(0)], center: .center,
                            startRadiusFraction: 0, endRadiusFraction: 0.5
                        )
                        .frame(width: size.width * blob.radiusX * 1.4, height: size.height * blob.radiusY * 1.4)
                        .position(x: size.width * blob.x, y: size.height * blob.y)
                    }
                }
                .blur(radius: blur)
            }
            .opacity(opacity)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

extension View {
    /// Draws `HeroGlow` behind this view's top edge, as the cards place it: wider than the
    /// screen (80 points past each side), from 120 points above to 400 below.
    public func heroGlow(opacity: Double = 1, top: CGFloat = -120) -> some View {
        background(alignment: .top) {
            HeroGlow(opacity: opacity)
                .frame(height: GlowBlob.height)
                .padding(.horizontal, -80)
                .offset(y: top)
        }
    }
}

/// One radial blob of the glow, in fractions of the glow's frame. Values from
/// design-kit/src/styles.css (`--pk-glow-copper`, light and dark); `HeroGlowTests` compares them.
nonisolated public struct GlowBlob: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let radiusX: Double
    public let radiusY: Double
    public let color: AdaptiveColor

    public static let blur: CGFloat = 50
    public static let height: CGFloat = 520

    public static let copper: [GlowBlob] = [
        GlowBlob(
            x: 0.30, y: 0.45, radiusX: 0.40, radiusY: 0.45,
            color: AdaptiveColor(
                light: RGBA(red: 255, green: 138, blue: 76, alpha: 0.55),
                dark: RGBA(red: 255, green: 100, blue: 50, alpha: 0.42))),
        GlowBlob(
            x: 0.75, y: 0.35, radiusX: 0.35, radiusY: 0.40,
            color: AdaptiveColor(
                light: RGBA(red: 255, green: 196, blue: 120, alpha: 0.45),
                dark: RGBA(red: 255, green: 160, blue: 80, alpha: 0.22))),
        GlowBlob(
            x: 0.60, y: 0.75, radiusX: 0.35, radiusY: 0.35,
            color: AdaptiveColor(
                light: RGBA(red: 255, green: 120, blue: 150, alpha: 0.28),
                dark: RGBA(red: 200, green: 70, blue: 120, alpha: 0.25))),
    ]
}
