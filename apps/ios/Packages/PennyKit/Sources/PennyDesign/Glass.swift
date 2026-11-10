public import SwiftUI

/// Liquid Glass for the control layer only: the tab bar, toolbars, the month picker,
/// search and floating buttons. Money and lists stay on solid surfaces.
///
/// The system tab bar and toolbars are already glass on iOS 26 and need nothing. Use this
/// for custom floating controls. With Reduce Transparency on, it draws an opaque surface
/// with a separator edge instead, as the redesign requires.
public struct PennyGlass<S: Shape>: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    private let shape: S
    private let tinted: Bool

    public init(in shape: S, tinted: Bool) {
        self.shape = shape
        self.tinted = tinted
    }

    public func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(tinted ? PennyColor.tint : PennyColor.surface, in: shape)
                .overlay(shape.stroke(PennyColor.separator, lineWidth: 1))
        } else {
            content.glassEffect(
                tinted ? .regular.tint(PennyColor.tint).interactive() : .regular.interactive(), in: shape)
        }
    }
}

extension View {
    public func pennyGlass<S: Shape>(in shape: S = Capsule(), tinted: Bool = false) -> some View {
        modifier(PennyGlass(in: shape, tinted: tinted))
    }
}
