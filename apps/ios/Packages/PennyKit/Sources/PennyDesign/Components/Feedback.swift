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

    public init(tone: Tone, title: String, message: String? = nil, @ViewBuilder action: () -> Action) {
        self.tone = tone
        self.title = title
        self.message = message
        self.action = action()
    }

    public var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(iconColor)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(PennyColor.label)
                if let message {
                    Text(message).font(.footnote).foregroundStyle(PennyColor.secondaryLabel)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            action
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: Metrics.minTouchTarget)
        .background(background, in: RoundedRectangle(cornerRadius: Metrics.rowRadius, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(tone == .error ? .isStaticText : [])
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
            if let undo { InlineActionButton("Undo", action: undo) }
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .padding(.vertical, 6)
        .pennyGlass(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel([title, detail].compactMap(\.self).joined(separator: ", "))
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

/// A category's icon on a tinted circle. Legacy categories name Ionicons; they map to SF
/// Symbols here, and colors come from the category palette, never a meaning color.
public struct CategoryIcon: View {
    @ScaledMetric private var size: Double
    private let symbol: String
    private let color: Color

    public init(symbol: String, color: Color, size: Double = 36) {
        self.symbol = symbol
        self.color = color
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
    }

    public var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(color.opacity(0.14), in: Circle())
            .accessibilityHidden(true)
    }
}

/// Maps legacy Ionicons names and category ids onto SF Symbols and the category palette.
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
        "card": "creditcard", "wallet": "wallet.bifold",
        // The category form's icon grid (MAZ-74, `category-form` card).
        "play": "play", "leaf": "leaf", "people": "person.2", "receipt": "doc.plaintext", "image": "photo",
        "document-text": "doc.text", "sunny": "sun.max", "moon": "moon", "time": "clock", "key": "key",
    ]
}
