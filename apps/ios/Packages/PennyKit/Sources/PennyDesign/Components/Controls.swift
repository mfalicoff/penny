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
    /// The cards' `.row` padding: 11pt above and below, 16pt at the sides.
    public static let rowInsets = EdgeInsets(top: 11, leading: 16, bottom: 11, trailing: 16)
    /// The cards' settings-style row (`.sr`, Settings, Accounts, Categories): 50pt in all, with
    /// 8pt above and below.
    public static let settingsRow: Double = 50
    public static let settingsRowInsets = EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)
}

extension View {
    /// A list row with the cards' `.row` metrics: the card's padding in place of the system's
    /// larger row insets, and 60pt tall in all (the card's `min-height` includes its padding).
    /// Apply it to the row's outermost view in the `List`.
    public func cardRow() -> some View {
        frame(minHeight: ControlSize.row - ControlSize.rowInsets.top - ControlSize.rowInsets.bottom)
            .listRowInsets(ControlSize.rowInsets)
    }

    /// A list row with the cards' `.sr` metrics (`ControlSize.settingsRow`), for the settings-style
    /// lists. Apply it to the row's outermost view in the `List`.
    public func cardSettingsRow() -> some View {
        frame(
            minHeight: ControlSize.settingsRow - ControlSize.settingsRowInsets.top
                - ControlSize.settingsRowInsets.bottom
        )
        .listRowInsets(ControlSize.settingsRowInsets)
    }

    /// The cards' group heading (`.gh`): small, semibold, upper case, in the secondary label
    /// color. Apply it to a list section's header; iOS 26 otherwise draws a larger title-case
    /// header.
    public func cardSectionHeader() -> some View {
        font(.footnote.weight(.semibold))
            .textCase(.uppercase)
            .foregroundStyle(PennyColor.secondaryLabel)
    }
}

/// A list section with the cards' group heading (`cardSectionHeader()`), for the common
/// `Section("Title") { … }`.
public struct CardSection<Content: View, Footer: View>: View {
    private let title: Text
    private let content: Content
    private let footer: Footer

    public init(
        _ title: LocalizedStringKey, @ViewBuilder content: () -> Content,
        @ViewBuilder footer: () -> Footer
    ) {
        self.title = Text(title)
        self.content = content()
        self.footer = footer()
    }

    public init<S: StringProtocol>(
        _ title: S, @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer
    ) {
        self.title = Text(title)
        self.content = content()
        self.footer = footer()
    }

    public var body: some View {
        Section {
            content
        } header: {
            title.cardSectionHeader()
        } footer: {
            footer
        }
    }
}

extension CardSection where Footer == EmptyView {
    public init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) {
        self.init(title, content: content) { EmptyView() }
    }

    public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) {
        self.init(title, content: content) { EmptyView() }
    }
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

/// A glass capsule with text, such as the month picker ("November ⌄"). `tinted` is the cards'
/// `.gcap.tinted`: copper glass with white text, for the one primary action on screen (Search
/// all months on `search-empty`).
public struct GlassCapsuleButton: View {
    @ScaledMetric(relativeTo: .body) private var height = ControlSize.glassButton
    private let title: String
    private let systemImage: String?
    private let tinted: Bool
    private let action: () -> Void

    public init(_ title: String, systemImage: String? = nil, tinted: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.tinted = tinted
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title).font(.body.weight(.semibold))
                if let systemImage { Image(systemName: systemImage).font(.footnote.weight(.bold)) }
            }
            .foregroundStyle(tinted ? Color.white : PennyColor.label)
            .padding(.horizontal, 14)
            .frame(minHeight: height)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .pennyGlass(in: Capsule(), tinted: tinted)
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

/// The cards' `.pill`: a capsule on the neutral fill, and, selected (`.pill.on`), filled with the
/// label color and its text in the surface color. Selection isn't an action, so it isn't copper.
/// The capsule is 34pt; the tap area is the 44pt minimum.
public struct PillButtonStyle: ButtonStyle {
    @ScaledMetric(relativeTo: .subheadline) private var height = 34
    private let selected: Bool

    public init(selected: Bool) { self.selected = selected }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(minHeight: height)
            .foregroundStyle(selected ? PennyColor.surface : PennyColor.label)
            .background(selected ? PennyColor.label : PennyColor.fill, in: Capsule())
            .opacity(configuration.isPressed ? 0.7 : 1)
            .frame(minHeight: Metrics.minTouchTarget)
            .contentShape(Rectangle())
    }
}

extension View {
    /// The cards draw a sheet's close (×) and a toolbar's + in the label color on glass; copper
    /// is kept for the one primary action (✓, Save). Apply it to the toolbar button.
    public func neutralToolbarGlyph() -> some View {
        tint(PennyColor.label)
    }
}
