/// The category form's choices (MAZ-74, `category-form` card) and how a stored category color
/// is drawn.
///
/// The ledger stores a category's color as `#RRGGBB` and its icon as an Ionicons name, because
/// the Expo and web apps read the same ledger. The form only offers the redesign's category
/// palette (`CategoryColor`, never a meaning color) and icons that have an SF Symbol here, and
/// it writes them in those stored forms. Older ledgers carry the legacy palette, which is
/// mapped onto the closest redesign color so every category still has one of the eight.
nonisolated extension CategoryStyle {
    /// The colors the form offers, in the card's order.
    public static let pickerColors: [CategoryColor] = [
        .home, .groceries, .transport, .food, .shopping, .entertainment, .health, .other,
    ]

    /// The icons the form offers, as the Ionicons names the ledger stores: the card's grid,
    /// then the legacy form's choices.
    public static let pickerIcons: [String] = [
        "home-outline", "basket-outline", "bus-outline", "cafe-outline", "pricetag-outline", "play-outline",
        "airplane-outline", "leaf-outline", "people-outline", "receipt-outline", "card-outline", "cash-outline",
        "image-outline", "document-text-outline", "sunny-outline", "moon-outline", "time-outline", "key-outline",
        "car-outline", "bag-handle-outline", "gift-outline", "heart-outline", "fitness-outline", "school-outline",
        "paw-outline", "briefcase-outline", "laptop-outline", "trending-up-outline", "musical-notes-outline",
        "ellipsis-horizontal",
    ]

    /// The legacy category palette (`palette` in the Expo app) mapped onto the redesign colors,
    /// by the default category that used each legacy color.
    static let legacyPalette: [String: CategoryColor] = [
        "#E47850": .food, "#C6953A": .home, "#6C9C79": .groceries, "#678DB1": .transport,
        "#9D83BA": .entertainment, "#C8798D": .shopping, "#89918C": .other,
    ]

    /// `#RRGGBB` for a palette color, as the ledger stores it.
    public static func hex(_ color: CategoryColor) -> String {
        let value = color.value
        let parts = [value.red, value.green, value.blue].map { channel -> String in
            let byte = Int((channel * 255).rounded())
            let text = String(byte, radix: 16, uppercase: true)
            return text.count == 1 ? "0" + text : text
        }
        return "#" + parts.joined()
    }

    /// The palette color to draw a category with: the stored color when it is a redesign
    /// color; otherwise the default category's color for a default id (their stored colors
    /// are legacy ones); otherwise the legacy color's mapping; otherwise `.other`.
    public static func color(forCategoryID id: String, hex stored: String) -> CategoryColor {
        let upper = stored.uppercased()
        if let match = CategoryColor.allCases.first(where: { hex($0) == upper }) { return match }
        if CategoryColor(rawValue: id) != nil || aliases[id] != nil { return color(forCategoryID: id) }
        return legacyPalette[upper] ?? .other
    }

    /// Whether two Ionicons names are the same icon (`home` and `home-outline`).
    public static func sameIcon(_ lhs: String, _ rhs: String) -> Bool { base(lhs) == base(rhs) }

    /// A name for VoiceOver: "Home", "Bag handle".
    public static func iconName(_ ionicon: String) -> String {
        let words = base(ionicon).split(separator: "-").joined(separator: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    /// A name for VoiceOver: "Blue", "Teal".
    public static func colorName(_ color: CategoryColor) -> String {
        switch color {
        case .home: "Blue"
        case .groceries: "Teal"
        case .transport: "Slate"
        case .food: "Pink"
        case .shopping: "Brown"
        case .entertainment: "Olive"
        case .health: "Ocean"
        case .other: "Gray"
        }
    }

    private static func base(_ name: String) -> String {
        name.replacingOccurrences(of: "-outline", with: "").replacingOccurrences(of: "-sharp", with: "")
    }
}
