import Foundation
import PennyData
import PennyDesign
import PennyDomain

/// The recap's words (MAZ-292, `iphone-recap` card), built without a view so tests read them.
enum RecapText {
    static func title(_ month: MonthKey) -> String { "\(MonthPicker.title(month, long: false)) recap" }

    static let subtitle = "Recorded entries · your share"

    /// "September", or "Oct 2025" for the same month a year earlier (the bars' labels).
    static func barTitle(_ month: MonthKey?, lastYear: Bool) -> String {
        guard let month else { return "" }
        guard lastYear else { return MonthPicker.title(month, long: false) }
        return DayText.date(month.first).formatted(.dateTime.month(.abbreviated).year())
    }

    /// The owner's decision for a first month (or year): the bar gives way to this line.
    static func noComparison(_ month: MonthKey?, lastYear: Bool) -> String {
        guard let month else { return "Nothing earlier to compare with" }
        return lastYear
            ? "No \(MonthPicker.title(month, long: true)) to compare with"
            : "No \(MonthPicker.title(month, long: false)) to compare with"
    }

    /// The sentence under the bars, in two parts so the first is bold, as on the card:
    /// "**4% more than September**, and 7% more than October last year." Nil when there is nothing
    /// to compare with.
    static func comparison(_ review: MonthReview) -> (lead: String, rest: String)? {
        let previous = part(review.previous, name: review.previous.month.map { MonthPicker.title($0, long: false) })
        let lastYear = part(
            review.lastYear, name: review.lastYear.month.map { "\(MonthPicker.title($0, long: false)) last year" })
        switch (previous, lastYear) {
        case (let first?, let second?): return (capitalized(first), ", and \(second).")
        case (let only?, nil), (nil, let only?): return (capitalized(only), ".")
        case (nil, nil): return nil
        }
    }

    /// "4% more than September", "the same as September", "nothing spent in September"; nil with
    /// nothing to compare.
    private static func part(_ compared: ComparedMonth, name: String?) -> String? {
        guard let spent = compared.spent, let name else { return nil }
        guard let change = compared.change else {
            return spent == 0 ? "nothing spent in \(name)" : nil
        }
        if change == 0 { return "the same as \(name)" }
        return "\(abs(change))% \(change > 0 ? "more" : "less") than \(name)"
    }

    private static func capitalized(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

    /// A biggest change's chip: "New" for a category with nothing the month before, else "+18%" or
    /// "−12%" (the typographic minus, as amounts use).
    static func chip(_ change: BiggestChange) -> String {
        guard let percent = change.percent else { return "New" }
        if percent > 0 { return "+\(percent)%" }
        if percent < 0 { return "\(MoneyFormat.minus)\(-percent)%" }
        return "0%"
    }

    /// Under a biggest change's name: "Nothing in September", "$256.20 in September".
    static func previously(_ change: BiggestChange, month: MonthKey?, currency: String) -> String {
        let name = month.map { MonthPicker.title($0, long: false) } ?? "the month before"
        if change.previous == 0 { return "Nothing in \(name)" }
        return "\(MoneyFormat.amount(change.previous, currency: currency)) in \(name)"
    }

    /// Who paid the top shared expense: "Your top shared expense · Jo paid", "· you paid".
    static func topShared(_ top: TopShared) -> String {
        switch top.payer {
        case .you: "Your top shared expense · you paid"
        case .member(let name): "Your top shared expense · \(name) paid"
        case nil: "Your top shared expense"
        }
    }

    /// "Others paid $612.80" and "of your $1,024.60 in split expenses".
    static func split(_ split: MonthReview.Split, currency: String) -> (title: String, detail: String) {
        (
            "Others paid \(MoneyFormat.amount(split.othersPaid, currency: currency))",
            "of your \(MoneyFormat.amount(split.total, currency: currency)) in split expenses"
        )
    }

    /// "9 days without spending", and "The longest run was Oct 19–22".
    static func quietDays(_ review: MonthReview) -> (title: String, detail: String?) {
        let count = review.daysWithoutSpending
        let title =
            count == 0
            ? "No days without spending" : count == 1 ? "1 day without spending" : "\(count) days without spending"
        guard let run = review.longestRun else { return (title, nil) }
        let start = DayText.date(run.start).formatted(.dateTime.month(.abbreviated).day())
        if run.days == 1 { return (title, "The longest run was one day, \(start)") }
        return (title, "The longest run was \(start)–\(run.end.day)")
    }

    /// "Nothing to recap yet" explained for the month.
    static func emptyMessage(_ month: MonthKey) -> String {
        "A recap needs at least one recorded entry, and \(MonthPicker.title(month, long: false)) has none. "
            + "Scheduled entries count once they're recorded."
    }

    /// The banner's title: "Your October recap is ready".
    static func bannerTitle(_ month: MonthKey) -> String {
        "Your \(MonthPicker.title(month, long: false)) recap is ready"
    }

    static let bannerMessage = "Where your money went last month, and what changed."

    /// The notification's only text (no amounts, titles or names): "Your October recap is ready."
    static func notificationBody(_ month: MonthKey) -> String { bannerTitle(month) + "." }
}
