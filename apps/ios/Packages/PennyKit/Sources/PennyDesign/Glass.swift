public import SwiftUI

/// Liquid Glass for the control layer only: the tab bar, toolbars, the month picker,
/// search and floating buttons. Money and lists stay on solid surfaces.
///
/// The system tab bar and toolbars are already glass on iOS 26 and need nothing. Use this
/// for custom floating controls. With Reduce Transparency on, in the system's settings or in
/// Penny's own (Settings › Appearance, MAZ-250: `pennyReducesTransparency`), it draws an
/// opaque surface with a separator edge instead, as the redesign requires.
public struct PennyGlass<S: Shape>: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var systemReducesTransparency
    @Environment(\.pennyReducesTransparency) private var appReducesTransparency
    private let shape: S
    private let tinted: Bool

    public init(in shape: S, tinted: Bool) {
        self.shape = shape
        self.tinted = tinted
    }

    public func body(content: Content) -> some View {
        if systemReducesTransparency || appReducesTransparency {
            content
                .background(tinted ? PennyColor.tint : PennyColor.surface, in: shape)
                .overlay(shape.stroke(PennyColor.separator, lineWidth: 1))
        } else {
            content.glassEffect(
                tinted ? .regular.tint(PennyColor.tint).interactive() : .regular.interactive(), in: shape)
        }
    }
}

extension EnvironmentValues {
    /// Penny's own Reduce transparency (Settings › Appearance), set at the root. The system's
    /// setting applies as well, whatever this says.
    @Entry public var pennyReducesTransparency = false
}

extension View {
    public func pennyGlass<S: Shape>(in shape: S = Capsule(), tinted: Bool = false) -> some View {
        modifier(PennyGlass(in: shape, tinted: tinted))
    }
}

/// Solid navigation and tab bars while Penny's own Reduce transparency is on (MAZ-250): the
/// bars draw the surface color instead of Liquid Glass. The system's Reduce Transparency is handled by the system.
/// Apply it to every navigation stack's root and to each pushed page.
public struct PennySolidBars: ViewModifier {
    @Environment(\.pennyReducesTransparency) private var appReducesTransparency

    public init() {}

    public func body(content: Content) -> some View {
        #if os(iOS)
            content
                .toolbarBackground(PennyColor.surface, for: .navigationBar, .tabBar)
                .toolbarBackgroundVisibility(
                    appReducesTransparency ? .visible : .automatic, for: .navigationBar, .tabBar)
        #else
            content
        #endif
    }
}

extension View {
    /// See `PennySolidBars`.
    public func pennySolidBars() -> some View { modifier(PennySolidBars()) }
}
