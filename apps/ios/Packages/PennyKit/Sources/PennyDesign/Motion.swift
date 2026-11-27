public import SwiftUI

/// Penny's motion tokens and haptics (MAZ-287, docs/design/motion.md). Every animation in the app
/// takes its timing from here; no view names a literal duration, curve or `SensoryFeedback`.
/// The values mirror `tokens.motion` in contracts/design-baseline.json (`--pk-dur-*`,
/// `--pk-ease-*` in the kit); PennyDesignTests fails when they drift.
///
/// Views read `@Environment(\.accessibilityReduceMotion)` and pass it in. Under Reduce Motion
/// nothing slides, scales, shakes or counts: movement becomes a `quick` fade or happens at once.
/// Fades, highlights, progress and haptics stay.
nonisolated public enum Motion {
    /// The four durations. Exits use `quick` (or `standard` for a whole view).
    public enum Duration: Double, CaseIterable, Sendable {
        case quick = 0.15
        case standard = 0.25
        case emphasized = 0.4
        /// Only the fade of the "this changed" highlight on a saved row. Never for movement.
        case linger = 1.0

        /// The baseline's key.
        public var name: String {
            switch self {
            case .quick: "quick"
            case .standard: "standard"
            case .emphasized: "emphasized"
            case .linger: "linger"
            }
        }

        public var milliseconds: Int { Int((rawValue * 1000).rounded()) }
    }

    /// The three easings. `standard` is a spring on iOS: `.snappy` shows no overshoot at these
    /// durations and keeps its velocity when it's retargeted.
    public enum Easing: String, CaseIterable, Sendable {
        case standard, exit, linear

        /// The CSS the web uses for the same token (the baseline's value).
        public var css: String {
            switch self {
            case .standard: "cubic-bezier(0.2, 0, 0, 1)"
            case .exit: "cubic-bezier(0.4, 0, 1, 1)"
            case .linear: "linear"
            }
        }

        public func animation(_ duration: Duration) -> Animation {
            switch self {
            case .standard: .snappy(duration: duration.rawValue)
            case .exit: .easeIn(duration: duration.rawValue)
            case .linear: .linear(duration: duration.rawValue)
            }
        }
    }

    /// Movement is short: things slide a little and fade.
    public enum Distance {
        /// A row or toast arriving, a menu opening, a banner sliding down.
        public static let nudge: CGFloat = 8
        /// A month's content sliding in.
        public static let shift: CGFloat = 24
        /// Each swing of the refused-field shake.
        public static let shake: CGFloat = 6
        /// The scale of a pressed custom button or row.
        public static let press: CGFloat = 0.97
        /// The opacity of a pressed control under Reduce Motion, instead of scaling.
        public static let pressedOpacity: Double = 0.7

        /// The baseline's distances, by key.
        public static let all: [String: CGFloat] = ["nudge": nudge, "shift": shift, "shake": shake]
    }

    /// The animation for a token whose reduced form is a fade: a quick fade under Reduce Motion.
    /// `exit` is for things that leave the screen.
    public static func animation(_ duration: Duration, exit: Bool = false, reduceMotion: Bool) -> Animation {
        if reduceMotion { return Easing.standard.animation(.quick) }
        return (exit ? Easing.exit : Easing.standard).animation(duration)
    }

    /// The animation for a change whose reduced form happens at once (totals counting, bars and
    /// bands moving, rows making room): nil under Reduce Motion.
    public static func movement(_ duration: Duration, exit: Bool = false, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : animation(duration, exit: exit, reduceMotion: false)
    }

    /// The highlight fade on a saved row. It isn't motion, so it stays under Reduce Motion.
    public static var highlightFade: Animation { Easing.linear.animation(.linger) }

    /// An element that arrives from `edge` by `distance` and fades in (`duration`, standard
    /// easing), and leaves the same way, faster (`quick`, exit easing). Under Reduce Motion it
    /// only fades, at `quick`.
    public static func transition(
        edge: Edge, distance: CGFloat = Distance.nudge, duration: Duration = .standard, reduceMotion: Bool
    ) -> AnyTransition {
        if reduceMotion { return AnyTransition.opacity.animation(Easing.standard.animation(.quick)) }
        let offset = offset(edge, distance)
        return .asymmetric(
            insertion: AnyTransition.offset(offset).combined(with: .opacity)
                .animation(Easing.standard.animation(duration)),
            removal: AnyTransition.offset(offset).combined(with: .opacity).animation(Easing.exit.animation(.quick))
        )
    }

    /// The month's content: the new month slides `shift` in from the side it comes from (an
    /// earlier month from the leading edge, mirrored right to left) and fades in (`emphasized`);
    /// the old one fades out (`quick`) without moving. Under Reduce Motion a quick crossfade.
    public static func monthTransition(
        earlier: Bool, layoutDirection: LayoutDirection = .leftToRight, reduceMotion: Bool
    ) -> AnyTransition {
        if reduceMotion { return AnyTransition.opacity.animation(Easing.standard.animation(.quick)) }
        let fromLeft = earlier == (layoutDirection == .leftToRight)
        return .asymmetric(
            insertion: AnyTransition.offset(x: fromLeft ? -Distance.shift : Distance.shift)
                .combined(with: .opacity).animation(Easing.standard.animation(.emphasized)),
            removal: AnyTransition.opacity.animation(Easing.exit.animation(.quick))
        )
    }

    static func offset(_ edge: Edge, _ distance: CGFloat) -> CGSize {
        switch edge {
        case .top: CGSize(width: 0, height: -distance)
        case .bottom: CGSize(width: 0, height: distance)
        case .leading: CGSize(width: -distance, height: 0)
        case .trailing: CGSize(width: distance, height: 0)
        }
    }

    /// The refused-field shake: three swings of `shake`, settling at rest, in two `quick`s.
    public static let shakeOffsets: [CGFloat] = [Distance.shake, -Distance.shake, Distance.shake * 0.5, 0]
    public static var shakeDuration: Double { Duration.quick.rawValue * 2 }
}

// MARK: - Haptics

extension Motion {
    /// One haptic per action the person takes (docs/design/motion.md#haptics-ios). Attach with
    /// `.sensoryFeedback(Motion.Haptic.save.feedback, trigger:)` on the same value that drives the
    /// animation. Changes that arrive on their own (a sync from another device) play nothing.
    /// Haptics stay under Reduce Motion.
    public enum Haptic: CaseIterable, Sendable {
        /// Save a new entry or an edit.
        case save
        /// A save the rules refuse (the shake).
        case refused
        /// A save or sync that failed after the person's action.
        case failed
        /// Undo, from the saved toast or after a delete.
        case undo
        /// Step to another month or period, or pick one in the calendar.
        case stepPeriod
        /// Focus a chart element (a Sankey band or label, a category in Insights).
        case focusChart
        /// Delete an entry after its confirmation.
        case delete
        /// A bulk change or delete in Activity, however many rows.
        case bulkChange
        /// Select or deselect a row in Activity's selection mode.
        case select
        /// Open or close a Penny-drawn sheet, menu or popover.
        case openClose
        /// A disclosure opens or closes.
        case disclosure
        /// A destructive confirmation appears.
        case destructiveConfirmation
        /// A switch or segmented control Penny draws (Expense, Income, Invest).
        case toggle
        /// Sync now or Retry finished.
        case syncSucceeded
        /// Sync now or Retry failed.
        case syncFailed
        /// Show or hide the iPad sidebar.
        case sidebar
        /// Open an entry, a household or a trip.
        case open
        /// Dismiss the recap banner (MAZ-292).
        case dismissRecap
        /// Open the recap: the banner, Insights' Recap button (MAZ-292).
        case openRecap
        /// Dismiss a schedule suggestion on Recurring (MAZ-290).
        case dismissSuggestion

        public var feedback: SensoryFeedback {
            switch self {
            case .save, .syncSucceeded: .success
            case .refused, .failed, .syncFailed: .error
            case .undo, .openClose, .sidebar, .dismissRecap, .dismissSuggestion: .impact(weight: .light)
            case .stepPeriod, .focusChart, .select, .disclosure, .toggle, .open, .openRecap: .selection
            case .delete, .bulkChange: .impact(weight: .medium)
            case .destructiveConfirmation: .warning
            }
        }
    }
}

// MARK: - View helpers

extension View {
    /// Plays `haptic` when `trigger` changes. The one way views attach a haptic.
    public func pennyHaptic<T: Equatable>(_ haptic: Motion.Haptic, trigger: T) -> some View {
        sensoryFeedback(haptic.feedback, trigger: trigger)
    }

    /// A total that counts digit by digit to its new value (`emphasized`), with tabular figures so
    /// its width doesn't jitter. Under Reduce Motion the new number appears at once. VoiceOver
    /// reads only the final value, from the view's own label.
    public func pennyCounting(_ value: Double) -> some View {
        modifier(CountingModifier(value: value))
    }

    /// The refused-field shake, each time `trigger` changes. Nothing under Reduce Motion; the
    /// error text, the outline and the haptic don't depend on it.
    public func pennyShake(trigger: Int) -> some View {
        modifier(ShakeModifier(trigger: trigger))
    }

    /// A row that is new or just edited: `tint-soft` behind it, fading out over `linger`. The
    /// highlight isn't motion, so it stays under Reduce Motion.
    public func pennyChangedHighlight(_ active: Bool, in shape: some Shape = Rectangle()) -> some View {
        background(PaletteToken.tintSoft.value.color.opacity(active ? 1 : 0), in: shape)
            .animation(active ? nil : Motion.highlightFade, value: active)
    }
}

private struct CountingModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let value: Double

    func body(content: Content) -> some View {
        content
            .monospacedDigit()
            .contentTransition(reduceMotion ? .identity : .numericText(value: value))
            .animation(Motion.movement(.emphasized, reduceMotion: reduceMotion), value: value)
    }
}

private struct ShakeModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Int

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content.keyframeAnimator(initialValue: CGFloat.zero, trigger: trigger) { view, offset in
                view.offset(x: offset)
            } keyframes: { _ in
                KeyframeTrack {
                    for offset in Motion.shakeOffsets {
                        CubicKeyframe(offset, duration: Motion.shakeDuration / Double(Motion.shakeOffsets.count))
                    }
                }
            }
        }
    }
}

/// A custom button, row or chip: scales to `press` while held (`quick`) and back on release;
/// under Reduce Motion it dims to 0.7 instead. System button styles keep their own press.
public struct PennyPressStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(PressEffect(isPressed: configuration.isPressed))
    }
}

/// The press itself, for button styles that draw their own label (`PillButtonStyle`).
public struct PressEffect: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isPressed: Bool

    public init(isPressed: Bool) { self.isPressed = isPressed }

    public func body(content: Content) -> some View {
        content
            .scaleEffect(!reduceMotion && isPressed ? Motion.Distance.press : 1)
            .opacity(reduceMotion && isPressed ? Motion.Distance.pressedOpacity : 1)
            .animation(Motion.animation(.quick, reduceMotion: reduceMotion), value: isPressed)
    }
}

extension ButtonStyle where Self == PennyPressStyle {
    /// Penny's press for custom buttons, rows and chips.
    public static var pennyPress: PennyPressStyle { PennyPressStyle() }
}

extension View {
    /// A chart, bar or band that moves to its new values (`emphasized`) when `value` changes:
    /// lengths, heights, angles and widths. At once under Reduce Motion.
    public func pennyChartMotion<V: Equatable>(_ value: V) -> some View {
        modifier(ChartMotionModifier(value: value))
    }

    /// The month's content, keyed by `month`: a new month slides in from the side it comes from and
    /// the old one fades out (`Motion.monthTransition`). Put it inside a ZStack so they overlap.
    public func pennyMonthContent<K: Hashable>(_ month: K, earlier: Bool) -> some View {
        modifier(MonthContentModifier(month: month, earlier: earlier))
    }
}

private struct ChartMotionModifier<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let value: V

    func body(content: Content) -> some View {
        content.animation(Motion.movement(.emphasized, reduceMotion: reduceMotion), value: value)
    }
}

private struct MonthContentModifier<K: Hashable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    let month: K
    let earlier: Bool

    func body(content: Content) -> some View {
        content
            .id(month)
            .transition(
                Motion.monthTransition(earlier: earlier, layoutDirection: layoutDirection, reduceMotion: reduceMotion))
    }
}

extension View {
    /// Plays `haptic` when `trigger` changes and `condition` holds for the old and new values.
    public func pennyHaptic<T: Equatable>(
        _ haptic: Motion.Haptic, trigger: T, condition: @escaping (_ old: T, _ new: T) -> Bool
    ) -> some View {
        sensoryFeedback(haptic.feedback, trigger: trigger, condition: condition)
    }
}

extension View {
    /// A label or icon that crossfades when `value` changes (`duration`; `quick` under Reduce
    /// Motion, since a crossfade is a change of state, not movement).
    public func pennyCrossfade<V: Equatable>(_ value: V, duration: Motion.Duration = .standard) -> some View {
        modifier(CrossfadeModifier(value: value, duration: duration))
    }
}

private struct CrossfadeModifier<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let value: V
    let duration: Motion.Duration

    func body(content: Content) -> some View {
        content
            .contentTransition(.opacity)
            .animation(Motion.animation(duration, reduceMotion: reduceMotion), value: value)
    }
}
