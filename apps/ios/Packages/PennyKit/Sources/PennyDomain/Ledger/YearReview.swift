// The year in review (MAZ-292, phase 2): a year's recorded numbers, computed from its 12 months
// the same way on every platform. A port of `yearReview` in apps/web/src/domain/yearReview.ts,
// checked against contracts/fixtures/year-review.json (`YearReviewTests`).
//
// Input is the person's report (`LedgerReport`), as for the monthly recap: shared expenses count
// at the person's share, shared rows in another currency are already left out, and only recorded
// entries count (`LedgerReport.month`), never scheduled previews. `households` are the person's
// households, for the shared trips and the households where shared expenses were paid.
//
// Days are counted from January 1, or from the first recorded entry in a first year, up to today
// (the whole year once it's over), so a first year never counts the months before Penny.
//
// Nothing here reads titles, notes or receipts: the share card is built from this result alone.

/// The year in review of one year (`LedgerReport.yearReview`).
public struct YearReview: Hashable, Sendable {
    public let year: Int
    /// No recorded entry in the year (only scheduled entries counts as none).
    public let isEmpty: Bool
    /// The first counted day: January 1, or the first recorded entry in a first year. Nil with none
    /// up to today.
    public let from: CalendarDate?
    /// The last counted day: December 31, or today while the year is under way.
    public let to: CalendarDate
    public let spent: Int64
    /// All 12 months, January first.
    public let months: [Month]
    /// The month with the most recorded spending (the earliest on a tie); nil with no spending.
    public let busiestMonth: Month?
    /// Spending over the counted months (from `from` to `to`), rounded half up to whole cents.
    public let monthlyAverage: Int64
    /// Up to five categories, largest first, matched by name as in the recap.
    public let topCategories: [Category]
    public let trips: Trips
    public let shared: Shared
    public let facts: Facts

    /// One of the person's households, as the year in review reads it (`GET /api/households`).
    public struct Household: Hashable, Sendable {
        public var id: String
        /// Current members, you included.
        public var memberCount: Int
        /// The travel range of a shared trip; nil for a household.
        public var trip: TripRange?

        public init(id: String, memberCount: Int, trip: TripRange? = nil) {
            self.id = id
            self.memberCount = memberCount
            self.trip = trip
        }
    }

    public struct Month: Hashable, Sendable {
        public let month: MonthKey
        public let spent: Int64
    }

    public struct Category: Hashable, Sendable {
        /// The name trimmed and without case: categories match by name.
        public let key: String
        public let name: String
        public let icon: String
        public let color: String
        public let amount: Int64
        /// Whole percent of the year's spending.
        public let share: Int
    }

    public struct Trip: Hashable, Sendable {
        public enum Kind: String, Hashable, Sendable {
            case personal
            case shared
        }

        /// The personal trip's id, or the shared trip's household id.
        public let id: String
        public let kind: Kind
        public let startDate: CalendarDate
        public let endDate: CalendarDate
        /// Days of the trip in the counted range, from `from` up to `to`.
        public let days: Int
        /// Your recorded share of the trip's expenses dated in the year.
        public let share: Int64
        /// Others on a shared trip (its members but you); 0 for a personal trip ("only you").
        public let sharedWith: Int
    }

    public struct Trips: Hashable, Sendable {
        /// Trips with days in the year, your largest share first.
        public let list: [Trip]
        /// Days on any trip, each day once.
        public let daysAway: Int
        public let share: Int64
        /// The longest trip (the costlier, then the earlier, on a tie).
        public let longestId: String?
        /// The costliest trip (the longer, then the earlier, on a tie).
        public let costliestId: String?
    }

    public struct Payer: Hashable, Sendable {
        /// "you", or the payer's email in lower case. Never shown.
        public let key: String
        /// True for your own row.
        public let isYou: Bool
        /// Who paid as the household sees them (nil for you): a display name, else the email, and
        /// "Former member" for a deleted account.
        public let name: String?
        public let count: Int
        /// Households the payer paid in, most expenses first (then by id).
        public let householdIds: [String]
    }

    public struct Shared: Hashable, Sendable {
        /// Recorded shared expenses in the year.
        public let count: Int
        /// Whole percent of them you paid for.
        public let paidByYouPercent: Int
        /// Counted by who paid, most first, you before others on a tie; rows with no known payer
        /// are left out.
        public let payers: [Payer]
        /// Households of the shared expenses, most expenses first (then by id).
        public let householdIds: [String]
        /// Of the expenses split with others (total above your share), what others paid.
        public let othersPaid: Int64
    }

    public struct FrequentCategory: Hashable, Sendable {
        public let key: String
        public let name: String
        public let icon: String
        public let color: String
        public let count: Int
    }

    public struct Facts: Hashable, Sendable {
        public let daysWithoutSpending: Int
        public let longestRun: MonthReview.Run?
        public let expensesRecorded: Int
        /// Expenses a week over the counted days, rounded half up; 0 with no counted day.
        public let perWeek: Int
        /// ISO weekday (1 Monday … 7 Sunday) with the most spending, the earliest on a tie; nil
        /// with none.
        public let busiestWeekday: Int?
        /// The category with the most recorded expenses (the larger amount, then the key, on a tie).
        public let mostFrequentCategory: FrequentCategory?
    }

    /// The year the year in review is offered for (owner decision, 2026-11-26): from December 26
    /// to January 31. December 26–31 offers the year under way; January offers the year just over.
    /// Nil otherwise. The Insights card shows for the whole window.
    public static func offeredYear(today: CalendarDate) -> Int? {
        if today.month == 12, today.day >= 26 { return today.year }
        if today.month == 1 { return today.year - 1 }
        return nil
    }

    /// The year of the January banner ("Your 2026 in review is ready"): January only. Dismissing
    /// it is kept on the device.
    public static func bannerYear(today: CalendarDate) -> Int? {
        today.month == 1 ? today.year - 1 : nil
    }
}

extension LedgerReport {
    /// The year in review of `year`. `today` is the person's local date: income dated after it is
    /// expected, not recorded, and days after it aren't counted.
    public func yearReview(_ year: Int, today: CalendarDate, households: [YearReview.Household]) -> YearReview {
        var months: [YearReview.Month] = []
        var recorded: [ReportEntry] = []
        for index in 1...12 {
            guard let month = MonthKey(year: year, month: index) else { continue }
            let summary = self.month(month, today: today)
            months.append(YearReview.Month(month: month, spent: summary.recorded.expense))
            recorded += summary.recordedEntries
        }
        let expenses = recorded.filter { $0.kind == .expense }
        let spent = months.reduce(Int64(0)) { $0 + $1.spent }
        var busiest: YearReview.Month?
        for month in months where month.spent > (busiest?.spent ?? 0) { busiest = month }

        // The first recorded entry: previews never count, and income dated after today is expected.
        let first = self.recorded.filter { !$0.isExpectedIncome(today: today) }.map(\.date).min()
        let yearEnd = CalendarDate(year: year, month: 12, day: 31) ?? .latest
        let yearStart = CalendarDate(year: year, month: 1, day: 1) ?? .earliest
        let to = min(yearEnd, today)
        let from: CalendarDate? = first.flatMap { $0 <= to ? max(yearStart, $0) : nil }
        let countedDays = from.map { Self.daysBetween($0, to) } ?? 0
        let countedMonths = from.map { to.month - $0.month + 1 } ?? 0

        // ---------- categories ----------
        var amounts: [String: Int64] = [:]
        var counts: [String: Int] = [:]
        for entry in expenses {
            amounts[entry.categoryId, default: 0] += entry.share
            counts[entry.categoryId, default: 0] += 1
        }
        let categories = self.categories.filter { $0.kind == .expense }
        let spending = categories.compactMap { category -> CategorySpending? in
            guard let amount = amounts[category.id], amount > 0 else { return nil }
            return CategorySpending(category, amount: amount)
        }
        let topCategories = CategoryChange.compare(current: spending, previous: [], limit: nil).prefix(5).map {
            YearReview.Category(
                key: $0.key, name: $0.name, icon: $0.icon, color: $0.color, amount: $0.current, share: $0.share)
        }

        // The most frequent category, matched by name as the comparison does.
        var frequent: [String: (row: YearReview.FrequentCategory, amount: Int64)] = [:]
        for category in categories {
            guard let count = counts[category.id], count > 0 else { continue }
            let key = CategoryChange.key(category.name)
            let row =
                frequent[key]
                ?? (
                    YearReview.FrequentCategory(
                        key: key, name: category.name, icon: category.icon, color: category.color, count: 0), 0
                )
            frequent[key] = (
                YearReview.FrequentCategory(
                    key: key, name: row.row.name, icon: row.row.icon, color: row.row.color,
                    count: row.row.count + count),
                row.amount + (amounts[category.id] ?? 0)
            )
        }
        let mostFrequent = frequent.values.sorted {
            if $0.row.count != $1.row.count { return $0.row.count > $1.row.count }
            if $0.amount != $1.amount { return $0.amount > $1.amount }
            return JavaScriptText.ordinalLess($0.row.key, $1.row.key)
        }
        .first?.row

        // ---------- trips ----------
        let trips = Self.trips(
            ledger.trips, households: households, expenses: expenses, from: from, to: to)

        // ---------- who paid ----------
        let shared = expenses.filter {
            if case .shared = $0.source { return true }
            return false
        }
        struct PayerRow {
            var key: String
            var isYou: Bool
            var name: String?
            var count = 0
            var households: [String: Int] = [:]
        }
        var payers: [String: PayerRow] = [:]
        var householdCounts: [String: Int] = [:]
        var paidByYou = 0
        for entry in shared {
            guard case .shared(let householdId, _) = entry.source else { continue }
            householdCounts[householdId, default: 0] += 1
            let key: String
            let name: String?
            switch entry.payer {
            case .you:
                paidByYou += 1
                key = "you"
                name = nil
            case .member(let shown):
                key = JavaScriptText.lowercase(entry.payerEmail ?? shown)
                name = shown
            case nil:
                continue
            }
            var row = payers[key] ?? PayerRow(key: key, isYou: entry.payer == .you, name: name)
            row.count += 1
            row.households[householdId, default: 0] += 1
            payers[key] = row
        }
        let payerList = payers.values
            .sorted {
                if $0.count != $1.count { return $0.count > $1.count }
                if $0.isYou != $1.isYou { return $0.isYou }
                return JavaScriptText.ordinalLess($0.key, $1.key)
            }
            .map {
                YearReview.Payer(
                    key: $0.key, isYou: $0.isYou, name: $0.name, count: $0.count,
                    householdIds: Self.ranked($0.households))
            }
        let othersPaid = expenses.filter { $0.total > $0.share }.reduce(Int64(0)) { $0 + $1.total - $1.share }

        // ---------- facts ----------
        var spentOn: [CalendarDate: Int64] = [:]
        for entry in expenses where entry.share > 0 { spentOn[entry.date, default: 0] += entry.share }
        var daysWithoutSpending = 0
        var longestRun: MonthReview.Run?
        if let from {
            var start: CalendarDate?
            var length = 0
            var last = from
            func close() {
                if let start, length > (longestRun?.days ?? 0) {
                    longestRun = MonthReview.Run(start: start, end: last, days: length)
                }
                start = nil
                length = 0
            }
            var date = from
            while date <= to {
                if spentOn[date] != nil {
                    close()
                } else {
                    daysWithoutSpending += 1
                    if start == nil { start = date }
                    length += 1
                }
                last = date
                date = date.adding(days: 1)
            }
            close()
        }
        var weekdays: [Int: Int64] = [:]
        for (date, amount) in spentOn { weekdays[date.mondayBasedWeekday + 1, default: 0] += amount }
        let busiestWeekday = weekdays.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.first?.key

        return YearReview(
            year: year, isEmpty: recorded.isEmpty, from: from, to: to, spent: spent, months: months,
            busiestMonth: busiest,
            monthlyAverage: countedMonths > 0 ? Self.roundHalfUp(Double(spent) / Double(countedMonths)) : 0,
            topCategories: Array(topCategories), trips: trips,
            shared: YearReview.Shared(
                count: shared.count, paidByYouPercent: ReviewPercent.of(Int64(paidByYou), Int64(shared.count)),
                payers: payerList, householdIds: Self.ranked(householdCounts), othersPaid: othersPaid),
            facts: YearReview.Facts(
                daysWithoutSpending: daysWithoutSpending, longestRun: longestRun, expensesRecorded: expenses.count,
                perWeek: countedDays > 0 ? Int(Self.roundHalfUp(Double(expenses.count * 7) / Double(countedDays))) : 0,
                busiestWeekday: busiestWeekday, mostFrequentCategory: mostFrequent))
    }

    /// Shared trips (households with a travel range) and personal trips not linked to a shared trip
    /// you can still see, with their days in the counted range and your share of their expenses.
    static func trips(
        _ personal: [Trip], households: [YearReview.Household], expenses: [ReportEntry], from: CalendarDate?,
        to: CalendarDate
    ) -> YearReview.Trips {
        // Days of a trip in the counted range (none before the first recorded entry, nor after today).
        func inYear(_ start: CalendarDate, _ end: CalendarDate) -> Int {
            guard let from else { return 0 }
            return daysBetween(max(start, from), min(end, to))
        }
        struct Row {
            var id: String
            var kind: YearReview.Trip.Kind
            var start: CalendarDate
            var end: CalendarDate
            var days: Int
            var share: Int64 = 0
            var sharedWith: Int
            var tripIds: Set<String>
        }
        var rows: [Row] = []
        let sharedIds = Set(households.filter { $0.trip != nil }.map(\.id))
        for household in households {
            guard let range = household.trip else { continue }
            let linked = personal.filter { $0.sharedHouseholdId == household.id }.map(\.id)
            rows.append(
                Row(
                    id: household.id, kind: .shared, start: range.start, end: range.end,
                    days: inYear(range.start, range.end), sharedWith: max(household.memberCount - 1, 0),
                    tripIds: Set(linked)))
        }
        // A personal trip linked to a shared trip you can still see is counted with it, never twice.
        for trip in personal where !(trip.sharedHouseholdId.map(sharedIds.contains) ?? false) {
            rows.append(
                Row(
                    id: trip.id, kind: .personal, start: trip.startDate, end: trip.endDate,
                    days: inYear(trip.startDate, trip.endDate), sharedWith: 0, tripIds: [trip.id]))
        }
        for entry in expenses {
            let index = rows.firstIndex { row in
                if case .shared(let householdId, _) = entry.source {
                    return row.kind == .shared && row.id == householdId
                }
                guard let tripId = entry.tripId else { return false }
                return row.tripIds.contains(tripId)
            }
            if let index { rows[index].share += entry.share }
        }
        let list = rows.filter { $0.days > 0 }
            .map {
                YearReview.Trip(
                    id: $0.id, kind: $0.kind, startDate: $0.start, endDate: $0.end, days: $0.days, share: $0.share,
                    sharedWith: $0.sharedWith)
            }
            .sorted {
                if $0.share != $1.share { return $0.share > $1.share }
                if $0.days != $1.days { return $0.days > $1.days }
                if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
                return JavaScriptText.ordinalLess($0.id, $1.id)
            }
        var away = Set<CalendarDate>()
        for trip in list {
            var date = max(trip.startDate, from ?? to)
            let last = min(trip.endDate, to)
            while date <= last {
                away.insert(date)
                date = date.adding(days: 1)
            }
        }
        func pick(_ first: (YearReview.Trip, YearReview.Trip) -> Bool?) -> String? {
            list.sorted {
                if let decided = first($0, $1) { return decided }
                if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
                return JavaScriptText.ordinalLess($0.id, $1.id)
            }
            .first?.id
        }
        return YearReview.Trips(
            list: list, daysAway: away.count, share: list.reduce(Int64(0)) { $0 + $1.share },
            longestId: pick { lhs, rhs in
                if lhs.days != rhs.days { return lhs.days > rhs.days }
                if lhs.share != rhs.share { return lhs.share > rhs.share }
                return nil
            },
            costliestId: pick { lhs, rhs in
                if lhs.share != rhs.share { return lhs.share > rhs.share }
                if lhs.days != rhs.days { return lhs.days > rhs.days }
                return nil
            })
    }

    /// Days from `start` to `end`, both included; 0 when `end` is before `start`.
    static func daysBetween(_ start: CalendarDate, _ end: CalendarDate) -> Int {
        end < start ? 0 : end.days(since: start) + 1
    }

    /// Keys by count, most first, then by key in code-unit order.
    static func ranked(_ counts: [String: Int]) -> [String] {
        counts.sorted { $0.value != $1.value ? $0.value > $1.value : JavaScriptText.ordinalLess($0.key, $1.key) }
            .map(\.key)
    }

    /// JavaScript's `Math.round` for the non-negative values it's used on: half up.
    static func roundHalfUp(_ value: Double) -> Int64 { Int64((value + 0.5).rounded(.down)) }
}
