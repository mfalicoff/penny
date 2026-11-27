import Foundation
import PennyData
import PennyDesign
import PennyDomain

/// The year in review's words (MAZ-292, phase 2; `iphone-year-review*` and
/// `iphone-insights-year-review` cards), built without a view so tests read them. Every number
/// comes from the shared rule (`LedgerReport.yearReview`); only the pages add names the rule
/// doesn't carry: trips' and households' names, from the ledger and the households Penny loads.
/// The share image never uses these (`YearShareContent`).
enum YearReviewText {
    // MARK: Where it's offered

    /// Whether anything was recorded in `year` (only scheduled entries, or income still expected,
    /// counts as nothing): a year with nothing recorded offers no card and no banner.
    static func hasEntries(_ year: Int, report: LedgerReport, today: CalendarDate) -> Bool {
        report.recorded.contains { $0.date.year == year && !$0.isExpectedIncome(today: today) }
    }

    /// The year the Insights card offers, from December 26 to January 31 (`YearReview.offeredYear`),
    /// when something was recorded in it.
    static func offeredYear(today: CalendarDate, report: LedgerReport) -> Int? {
        guard let year = YearReview.offeredYear(today: today), hasEntries(year, report: report, today: today) else {
            return nil
        }
        return year
    }

    /// "2026 in review" (shown in capitals, as the cards' eyebrow).
    static func eyebrow(_ year: Int) -> String { "\(year) in review" }

    /// The January banner: "Your 2026 in review is ready".
    static func bannerTitle(_ year: Int) -> String { "Your \(year) in review is ready" }
    static let bannerMessage = "Top categories, trips, who paid and a few fun facts."

    /// The Insights card (`iphone-insights-year-review`).
    static let cardTitle = "Your year in Penny"
    static let cardMessage = "Top categories, trips, who paid and a few fun facts. Here until January 31."

    // MARK: Pages

    enum Page: Int, CaseIterable, Hashable {
        case categories, trips, shared, facts

        var name: String {
            switch self {
            case .categories: "categories"
            case .trips: "trips"
            case .shared: "shared"
            case .facts: "facts"
            }
        }
    }

    static let tapForNext = "Tap for the next page"
    static let lastPage = "Last page"

    /// "Home took the biggest share of your year"; "No spending in 2026" without any.
    static func leadTitle(_ review: YearReview) -> String {
        guard let top = review.topCategories.first else { return "No spending in \(review.year)" }
        return "\(top.name) took the biggest share of your year"
    }

    /// "You spent **$27,410** in 2026, your share of shared expenses included." in three parts, the
    /// amount bold.
    static func spentLede(_ year: Int) -> (lead: String, rest: String) {
        ("You spent ", " in \(year), your share of shared expenses included.")
    }

    /// "Busiest month: December"; nil with no spending.
    static func busiestTitle(_ review: YearReview) -> String? {
        review.busiestMonth.map { "Busiest month: \(MonthPicker.title($0.month, long: false))" }
    }

    /// "J" for January: a month's column label.
    static func monthLetter(_ month: MonthKey) -> String {
        DayText.date(month.first).formatted(.dateTime.month(.narrow))
    }

    static func plural(_ count: Int, _ one: String, _ many: String) -> String {
        "\(count) \(count == 1 ? one : many)"
    }

    /// "3 trips, 14 days away"; "No trips in 2026" without any.
    static func tripsTitle(_ review: YearReview, trips: Int? = nil, days: Int? = nil) -> String {
        guard !review.trips.list.isEmpty else { return "No trips in \(review.year)" }
        return
            "\(plural(trips ?? review.trips.list.count, "trip", "trips")), \(plural(days ?? review.trips.daysAway, "day", "days")) away"
    }

    /// "Lisbon was the longest, and cost you the most."; "Lisbon was the longest, and Ski week
    /// cost you the most."; one trip: "Lisbon was the only one." Nil without a trip or a name.
    static func tripsLede(_ review: YearReview, name: (String) -> String?) -> String? {
        guard !review.trips.list.isEmpty else {
            return "Trips you add, on your own or shared, show here with your days away."
        }
        guard let longestId = review.trips.longestId, let longest = name(longestId) else { return nil }
        if review.trips.list.count == 1 { return "\(longest) was your trip this year." }
        guard let costliestId = review.trips.costliestId, costliestId != longestId, let costliest = name(costliestId)
        else { return "\(longest) was the longest, and cost you the most." }
        return "\(longest) was the longest, and \(costliest) cost you the most."
    }

    /// "Nov 12–19 · shared with 3", "Feb 14–16 · only you".
    static func tripLine(_ trip: YearReview.Trip, today: CalendarDate) -> String {
        let dates = TripText.shortRange(TripRange(start: trip.startDate, end: trip.endDate), today: today)
        return "\(dates) · \(trip.sharedWith > 0 ? "shared with \(trip.sharedWith)" : "only you")"
    }

    /// Your own row's count of shared expenses.
    static func yourCount(_ review: YearReview) -> Int { review.shared.payers.first(where: \.isYou)?.count ?? 0 }

    /// "You paid for 41 shared expenses"; "No shared expenses in 2026" without any.
    static func sharedTitle(_ review: YearReview, count: Int? = nil) -> String {
        guard review.shared.count > 0 else { return "No shared expenses in \(review.year)" }
        let yours = count ?? yourCount(review)
        if yourCount(review) == 0 {
            return "Others paid for your \(plural(review.shared.count, "shared expense", "shared expenses"))"
        }
        return "You paid for \(plural(yours, "shared expense", "shared expenses"))"
    }

    /// "Jo paid for 30, across Apartment and Lisbon.": the person who paid the most after you, and
    /// where. Nil when nobody else paid.
    static func sharedLede(_ review: YearReview, householdName: (String) -> String?) -> String? {
        guard review.shared.count > 0 else {
            return "Expenses you share in a household or on a trip show here, counted by who paid."
        }
        guard let other = review.shared.payers.first(where: { !$0.isYou }) else { return nil }
        let names = other.householdIds.compactMap(householdName)
        let place = names.isEmpty ? "" : ", across \(list(names))"
        return "\(payerName(other)) paid for \(other.count)\(place)."
    }

    /// "Counted by who paid, out of 85 shared expenses." and, when others paid part of your split
    /// expenses, "Others paid **$4,120** of the ones you split."
    static func sharedFoot(_ review: YearReview) -> (counted: String, othersPaid: Int64?) {
        (
            "Counted by who paid, out of \(plural(review.shared.count, "shared expense", "shared expenses")).",
            review.shared.othersPaid > 0 ? review.shared.othersPaid : nil
        )
    }

    /// "You", or who paid as their household shows them ("Former member" for a deleted account).
    static func payerName(_ payer: YearReview.Payer) -> String {
        payer.isYou ? "You" : payer.name ?? HouseholdPeople.formerMember
    }

    /// "A", "A and B", "A, B and C".
    static func list(_ words: [String]) -> String {
        guard words.count > 1, let last = words.last else { return words.first ?? "" }
        return "\(words.dropLast().joined(separator: ", ")) and \(last)"
    }

    static let factsTitle = "A few things about your year"

    struct Fact: Hashable {
        /// `quiet`, `run`, `recorded`, `weekday`.
        let key: String
        let symbol: String
        /// The number the fact counts up to, when it is one.
        let count: Int?
        let value: String
        let caption: String
    }

    /// The fun facts, in the card's order; one with nothing to say is left out. Each comes from
    /// dates, counts and amounts only, never from an entry's text.
    static func facts(_ review: YearReview) -> [Fact] {
        let facts = review.facts
        var list = [
            Fact(
                key: "quiet", symbol: "calendar", count: facts.daysWithoutSpending,
                value: "\(facts.daysWithoutSpending)",
                caption: facts.daysWithoutSpending == 1 ? "day without spending" : "days without spending")
        ]
        if let run = facts.longestRun, run.days > 1 {
            list.append(
                Fact(
                    key: "run", symbol: "clock", count: run.days, value: plural(run.days, "day", "days"),
                    caption:
                        "your longest run without spending, in \(MonthPicker.title(MonthKey(run.start), long: false))"))
        }
        if facts.expensesRecorded > 0 {
            list.append(
                Fact(
                    key: "recorded", symbol: "list.bullet", count: facts.expensesRecorded,
                    value: "\(facts.expensesRecorded)",
                    caption:
                        "\(facts.expensesRecorded == 1 ? "expense" : "expenses") recorded, about \(facts.perWeek) a week"
                ))
        }
        if let weekday = facts.busiestWeekday {
            list.append(
                Fact(
                    key: "weekday", symbol: "sun.max", count: nil, value: weekdayName(weekday),
                    caption: "the day of the week you spent the most"))
        }
        return list
    }

    /// "came up most often: 96 times".
    static func frequentCaption(_ category: YearReview.FrequentCategory) -> String {
        category.count == 1 ? "came up most often: once" : "came up most often: \(category.count) times"
    }

    /// "Saturday" for 6 (ISO weekday, 1 Monday … 7 Sunday).
    static func weekdayName(_ weekday: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = .current
        // Sunday first.
        return calendar.weekdaySymbols[weekday % 7]
    }
}
