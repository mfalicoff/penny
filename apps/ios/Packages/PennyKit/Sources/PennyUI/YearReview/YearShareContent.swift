import Foundation
import PennyData
import PennyDesign
import PennyDomain

/// What the year's share image says (MAZ-292, phase 2; `iphone-year-review-share` and
/// `iphone-year-review-share-amounts` cards), as plain data the image view draws and tests read.
///
/// It is built from the `YearReview` result alone: category names, rankings, percentages, counts,
/// months and, with amounts shown, amounts and who paid. The review carries no entry titles, notes,
/// receipts, trip names or household names, and nothing here looks anything else up, so none of
/// them can reach the image. Who paid is named by the first word of their display name, never their
/// email: someone with no display name is "A member", a deleted account "Former member" (as the
/// web's `shareCard`). A line whose data is empty (no trips, no shared expenses, no spending) is
/// left out.
struct YearShareContent: Hashable {
    struct Category: Hashable {
        let rank: Int
        let name: String
        /// For the dot's color: the category's look, drawn in the light appearance.
        let key: String
        let color: CategoryColor
        /// "63%".
        let percent: String
        /// "$17,400", only with amounts shown.
        let amount: String?
    }

    struct Tile: Hashable {
        /// `month`, `trips`, `shared`, `quiet`.
        let key: String
        let title: String
        let subtitle: String
        /// Spans both columns.
        let wide: Bool
    }

    let showsAmounts: Bool
    /// "My 2026".
    let title: String
    /// Hidden: nil, then "Where my money went". Shown: "$27,410" (bold), then " spent".
    let total: String?
    let subtitle: String
    let categories: [Category]
    let tiles: [Tile]
    let footer = "Made with Penny"
    static let brand = "Penny"

    init(_ review: YearReview, currency: String, showsAmounts: Bool, locale: Locale = .current) {
        let money = { (cents: Int64) in MoneyFormat.whole(cents, currency: currency, locale: locale) }
        self.showsAmounts = showsAmounts
        title = "My \(review.year)"
        total = showsAmounts ? money(review.spent) : nil
        subtitle = showsAmounts ? " spent" : "Where my money went"
        categories = review.topCategories.prefix(3).enumerated().map { index, category in
            Category(
                rank: index + 1, name: category.name, key: category.key,
                color: CategoryStyle.color(forCategoryID: "", hex: category.color), percent: "\(category.share)%",
                amount: showsAmounts ? money(category.amount) : nil)
        }
        var tiles: [Tile] = []
        if let busiest = review.busiestMonth {
            let month = MonthPicker.title(busiest.month, long: false)
            tiles.append(
                Tile(
                    key: "month", title: month,
                    subtitle: showsAmounts ? "busiest month · \(money(busiest.spent))" : "busiest month", wide: false))
        }
        if !review.trips.list.isEmpty {
            tiles.append(
                Tile(
                    key: "trips", title: YearReviewText.plural(review.trips.list.count, "trip", "trips"),
                    subtitle: "\(YearReviewText.plural(review.trips.daysAway, "day", "days")) away", wide: false))
        }
        // A half tile alone takes the whole row.
        if tiles.count == 1, let only = tiles.first {
            tiles[0] = Tile(key: only.key, title: only.title, subtitle: only.subtitle, wide: true)
        }
        if let shared = Self.shared(review, showsAmounts: showsAmounts) { tiles.append(shared) }
        if review.from != nil {
            let days = review.facts.daysWithoutSpending
            tiles.append(
                Tile(
                    key: "quiet", title: "\(days)",
                    subtitle: days == 1 ? "day without spending" : "days without spending",
                    wide: true))
        }
        self.tiles = tiles
    }

    /// Hidden: "I paid for 48%" of our shared expenses. Shown: "I paid 41 · Jo paid 30", then
    /// "of our shared expenses · Mira 12".
    private static func shared(_ review: YearReview, showsAmounts: Bool) -> Tile? {
        let shared = review.shared
        guard shared.count > 0 else { return nil }
        guard showsAmounts, !shared.payers.isEmpty else {
            return Tile(
                key: "shared", title: "I paid for \(shared.paidByYouPercent)%", subtitle: "of our shared expenses",
                wide: true)
        }
        let paid = { (payer: YearReview.Payer) in
            payer.isYou ? "I paid \(payer.count)" : "\(shareName(payer)) paid \(payer.count)"
        }
        let title = shared.payers.prefix(2).map(paid).joined(separator: " · ")
        var subtitle = "of our shared expenses"
        if shared.payers.count > 2 {
            let third = shared.payers[2]
            subtitle += " · " + (third.isYou ? paid(third) : "\(shareName(third)) \(third.count)")
        }
        return Tile(key: "shared", title: title, subtitle: subtitle, wide: true)
    }

    /// A payer as the image may name them: the first word of their display name, never their
    /// email ("A member" without a display name), or "Former member".
    static func shareName(_ payer: YearReview.Payer) -> String {
        guard let name = payer.name, !name.isEmpty else { return "A member" }
        if name == HouseholdPeople.formerMember { return name }
        // The shown name is the email when there is no display name: never on the image.
        if name.contains("@") { return "A member" }
        return name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? "A member"
    }

    /// Every piece of text on the image, in reading order: its accessibility label, and what the
    /// tests check.
    var lines: [String] {
        [Self.brand, title, "\(total ?? "")\(subtitle)"]
            + categories.map {
                [String($0.rank), $0.name, $0.amount, $0.percent].compactMap(\.self).joined(separator: " ")
            }
            + tiles.map { "\($0.title) \($0.subtitle)" } + [footer]
    }
}
