public import SwiftUI

/// Control sizes from design-kit (`pk-btn` 50, `pk-gbtn` 44 and 62, `pk-row` 60). Every
/// tappable control is at least `Metrics.minTouchTarget` (44pt) and grows with Dynamic Type
/// through `@ScaledMetric` where it is used.
nonisolated public enum ControlSize {
    public static let button: Double = 50
    public static let glassButton: Double = 44
    public static let floatingButton: Double = 62
    public static let row: Double = 60
    public static let compactRow: Double = 46
}

/// A round Liquid Glass toolbar control (settings, calendar, back, sheet × and ✓). Icon-only,
/// so `label` is required for VoiceOver. `tinted` is for the one primary action on screen.
public struct GlassIconButton: View {
    @ScaledMetric(relativeTo: .body) private var size = ControlSize.glassButton
    private let systemImage: String
    private let label: String
    private let tinted: Bool
    private let action: () -> Void

    public init(_ label: String, systemImage: String, tinted: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.systemImage = systemImage
        self.tinted = tinted
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(tinted ? Color.white : PennyColor.label)
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .pennyGlass(in: Circle(), tinted: tinted)
        .accessibilityLabel(label)
    }
}

/// A glass capsule with text, such as the month picker ("November ⌄").
public struct GlassCapsuleButton: View {
    @ScaledMetric(relativeTo: .body) private var height = ControlSize.glassButton
    private let title: String
    private let systemImage: String?
    private let action: () -> Void

    public init(_ title: String, systemImage: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).font(.body.weight(.semibold))
                if let systemImage { Image(systemName: systemImage).font(.footnote.weight(.bold)) }
            }
            .foregroundStyle(PennyColor.label)
            .padding(.horizontal, 14)
            .frame(minHeight: height)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .pennyGlass(in: Capsule())
    }
}

/// A full-width primary or secondary button (`pk-btn`). Primary is the copper tint with
/// white text; there is one per screen.
public struct PennyButton: View {
    public enum Role { case primary, secondary, destructive }

    @ScaledMetric(relativeTo: .body) private var height = ControlSize.button
    private let title: String
    private let systemImage: String?
    private let role: Role
    private let action: () -> Void

    public init(_ title: String, systemImage: String? = nil, role: Role = .primary, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.role = role
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title)
            }
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: height)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var foreground: Color {
        switch role {
        case .primary: .white
        case .secondary: PennyColor.label
        case .destructive: PennyColor.danger
        }
    }

    private var background: Color {
        switch role {
        case .primary: PennyColor.tint
        case .secondary, .destructive: PennyColor.fill
        }
    }
}

/// The leaf mark (SF Symbol `leaf` on a copper tile), Penny's logo in the iPad sidebar and
/// on the lock screen.
public struct PennyMark: View {
    @ScaledMetric private var size: Double
    public init(size: Double = 34) { _size = ScaledMetric(wrappedValue: size, relativeTo: .title) }

    public var body: some View {
        Image(systemName: "leaf.fill")
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(PennyColor.tint, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Content on a solid surface: cards and inset lists never use glass, so money stays legible.
extension View {
    public func pennyCard(padding: Double = 18) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PennyColor.surface, in: RoundedRectangle(cornerRadius: Metrics.cardRadius, style: .continuous))
    }
}
