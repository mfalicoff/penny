public import SwiftUI

/// Inline status that always names the next step (design-kit `Banner`): offline with pending
/// changes, a save error that keeps the draft, the demo notice, or information.
/// The kind of `StatusBanner`.
public enum BannerTone: Sendable { case offline, error, info, demo }

public struct StatusBanner<Action: View>: View {
    public typealias Tone = BannerTone

    private let tone: Tone
    private let title: String
    private let message: String?
    private let action: Action
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    public init(tone: Tone, title: String, message: String? = nil, @ViewBuilder action: () -> Action) {
        self.tone = tone
        self.title = title
        self.message = message
        self.action = action()
    }

    public var body: some View {
        Group {
            // At accessibility text sizes the action goes under the text, so the title keeps
            // the full width and wraps between words instead of breaking one ("Change-s").
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    content
                    action
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .center, spacing: 12) {
                    // The text column takes every point the action doesn't need (no spacer, whose
                    // extra gap made "Couldn't sync · 1 change waiting" wrap); the action keeps its
                    // one-line width.
                    content.layoutPriority(1)
                    action.fixedSize()
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: Metrics.minTouchTarget)
        .background(background, in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(tone == .error ? .isStaticText : [])
    }

    private var content: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(iconColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(PennyColor.label)
                    .fixedSize(horizontal: false, vertical: true)
                if let message {
                    Text(message).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            // The title and message share one column as wide as the banner allows, so the
            // title doesn't wrap into a narrower column than its message (`save-error`).
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var icon: String {
        switch tone {
        case .offline: "icloud.slash"
        case .error: "exclamationmark.circle.fill"
        case .info: "info.circle"
        case .demo: "play.circle"
        }
    }

    private var iconColor: Color {
        switch tone {
        case .offline, .info: PennyColor.pending
        case .error: PennyColor.danger
        case .demo: PennyColor.tint
        }
    }

    private var background: Color {
        switch tone {
        case .offline: PennyColor.surface
        case .error: PaletteToken.dangerSoft.value.color
        case .info: PaletteToken.pendingSoft.value.color
        case .demo: PaletteToken.tintSoft.value.color
        }
    }
}

extension StatusBanner where Action == EmptyView {
    public init(tone: Tone, title: String, message: String? = nil) {
        self.init(tone: tone, title: title, message: message) { EmptyView() }
    }
}

/// A small action inside a banner or toast ("Retry", "Undo").
public struct InlineActionButton: View {
    @ScaledMetric(relativeTo: .subheadline) private var height = 36.0
    private let title: String
    private let action: () -> Void

    public init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(title, action: action)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(PennyColor.tintText)
            .padding(.horizontal, 12)
            .frame(minWidth: Metrics.minTouchTarget, minHeight: max(height, Metrics.minTouchTarget))
            .contentShape(Rectangle())
            .buttonStyle(.plain)
    }
}

/// The confirmation shown above the tab bar after saving, with Undo (design-kit `Toast`).
/// It is control-layer glass; it disappears by itself and is announced to VoiceOver.
public struct SaveToast: View {
    private let title: String
    private let detail: String?
    private let leading: AnyView?
    private let undo: (() -> Void)?

    public init(title: String, detail: String? = nil, leading: AnyView? = nil, undo: (() -> Void)? = nil) {
        self.title = title
        self.detail = detail
        self.leading = leading
        self.undo = undo
    }

    public var body: some View {
        HStack(spacing: 12) {
            if let leading { leading }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(PennyColor.label)
                if let detail {
                    Text(detail).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .monospacedDigit()
                }
            }
            Spacer(minLength: 0)
            if let undo { UndoCapsuleButton(action: undo) }
        }
        .padding(.leading, 10)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .frame(minHeight: 60)
        .pennyGlass(in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel([title, detail].compactMap(\.self).joined(separator: ", "))
    }
}

/// The toast's Undo (`.toast .undo`): copper text on a neutral capsule, 44pt tall.
private struct UndoCapsuleButton: View {
    @ScaledMetric(relativeTo: .subheadline) private var height = 44.0
    let action: () -> Void

    var body: some View {
        Button("Undo", action: action)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(PennyColor.tintText)
            .padding(.horizontal, 18)
            .frame(minHeight: max(height, Metrics.minTouchTarget))
            .background(PennyColor.fill, in: Capsule())
            .contentShape(Capsule())
            .buttonStyle(.plain)
    }
}

/// A named full-screen state: loading, empty, offline, error or unavailable. Every state
/// says what happened and, when there is one, offers the next step.
public struct PennyStateView: View {
    public enum Kind: Equatable, Sendable {
        case loading
        case empty
        case offline
        case error
        case unavailable
    }

    private let kind: Kind
    private let title: String
    private let message: String?
    private let actionTitle: String?
    private let action: (() -> Void)?

    public init(
        _ kind: Kind, title: String, message: String? = nil, actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.kind = kind
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        Group {
            if kind == .loading {
                VStack(spacing: 12) {
                    ProgressView()
                    Text(title).font(.subheadline).foregroundStyle(PennyColor.secondaryLabel)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityElement(children: .combine)
            } else {
                ContentUnavailableView {
                    Label(title, systemImage: icon)
                } description: {
                    if let message { Text(message) }
                } actions: {
                    if let actionTitle, let action {
                        Button(actionTitle, action: action).buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .accessibilityIdentifier("state.\(String(describing: kind))")
    }

    private var icon: String {
        switch kind {
        case .loading: "hourglass"
        case .empty: "tray"
        case .offline: "icloud.slash"
        case .error: "exclamationmark.triangle"
        case .unavailable: "clock.arrow.circlepath"
        }
    }
}

/// A category's icon: the design kit's `CategoryIcon` and the cards' `.ic`, a rounded tile in the
/// category's color with a white glyph (corner radius 31% of the side). Categories store
/// Ionicons names; they map to SF Symbols here, and colors come from the category palette,
/// never a meaning color.
public struct CategoryIcon: View {
    @ScaledMetric private var size: Double
    private let symbol: String
    private let color: Color
    private let glyph: Color

    public init(symbol: String, color: Color, glyph: Color = .white, size: Double = 36) {
        self.symbol = symbol
        self.color = color
        self.glyph = glyph
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
    }

    public var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.5, weight: .medium))
            .foregroundStyle(glyph)
            .frame(width: size, height: size)
            .background(color, in: RoundedRectangle(cornerRadius: size * 0.31, style: .continuous))
            .accessibilityHidden(true)
    }
}

extension CategoryIcon {
    /// The cards' neutral tile (`.ic` on `--fill`): a label-color glyph for things that are
    /// neither a category nor an action, such as a trip or a new household.
    public static func neutral(symbol: String, size: Double = 36) -> CategoryIcon {
        CategoryIcon(symbol: symbol, color: PennyColor.fill, glyph: PennyColor.label, size: size)
    }
}

/// Maps stored Ionicons names and category ids onto SF Symbols and the category palette.
nonisolated public enum CategoryStyle {
    public static func symbol(forIonicon name: String) -> String {
        let base = name.replacingOccurrences(of: "-outline", with: "").replacingOccurrences(of: "-sharp", with: "")
        return symbols[base] ?? "tag"
    }

    public static func color(forCategoryID id: String) -> CategoryColor {
        if let color = CategoryColor(rawValue: id) { return color }
        return aliases[id] ?? .other
    }

    static let aliases: [String: CategoryColor] = ["fun": .entertainment]

    static let symbols: [String: String] = [
        "basket": "basket", "cafe": "cup.and.saucer", "home": "house", "bus": "bus", "bag-handle": "bag",
        "musical-notes": "music.note", "heart": "heart", "ellipsis-horizontal": "ellipsis",
        "briefcase": "briefcase", "laptop": "laptopcomputer", "gift": "gift",
        "trending-up": "chart.line.uptrend.xyaxis",
        "airplane": "airplane", "car": "car", "restaurant": "fork.knife", "cart": "cart", "film": "film",
        "fitness": "figure.run", "medkit": "cross.case", "school": "graduationcap", "paw": "pawprint",
        "wifi": "wifi", "phone-portrait": "iphone", "flash": "bolt", "water": "drop", "shirt": "tshirt",
        "book": "book", "game-controller": "gamecontroller", "pricetag": "tag", "cash": "banknote",
        "card": "creditcard", "wallet": "wallet.bifold", "business": "building.2",
        // Seeded and imported categories (MAZ-219): Fun and the shared Streaming.
        "happy": "face.smiling", "tv": "tv",
        // The category form's icon grid (MAZ-74, `category-form` card).
        "play": "play", "leaf": "leaf", "people": "person.2", "receipt": "doc.plaintext", "image": "photo",
        "document-text": "doc.text", "sunny": "sun.max", "moon": "moon", "time": "clock", "key": "key",
    ]
}
