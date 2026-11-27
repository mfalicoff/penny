/// money.json
public struct MoneyFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var parse: [ParseCase]
    public var personalShares: [ShareCase]
    public var ledgerAmounts: [AmountCase]
    public var ledgerParticipants: [ParticipantsCase]

    /// Exactly one of `cents` and `error` is present.
    public struct ParseCase: Codable, Equatable, Sendable {
        public var input: String
        public var cents: Int64?
        public var error: String?
    }

    public struct ShareCase: Codable, Equatable, Sendable {
        public var total: Int64
        public var mode: String
        public var input: String
        public var share: Int64?
        public var error: String?
    }

    /// Deliberately includes invalid numbers (fractions, negatives).
    public struct AmountCase: Codable, Equatable, Sendable {
        public var total: Double
        public var share: Double
        public var valid: Bool
    }

    /// Contract 2.2.0: the optional participant count of a split expense on one entry
    /// (`list` "transaction") or rule ("recurring") of `kind`. A nil `participants` means the
    /// field is absent; it deliberately includes a fraction.
    public struct ParticipantsCase: Codable, Equatable, Sendable {
        public var kind: String
        public var list: String
        public var participants: Double?
        public var valid: Bool
    }
}

/// recurrence.json
public struct RecurrenceFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var next: [NextCase]
    public var sequences: [Sequence]

    public struct NextCase: Codable, Equatable, Sendable {
        public var date: String
        public var frequency: String
        public var anchorDay: Int
        public var next: String
    }

    public struct Sequence: Codable, Equatable, Sendable {
        public var start: String
        public var frequency: String
        public var anchorDay: Int
        public var dates: [String]
    }
}

/// merge-conflicts.json
public struct MergeFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var cases: [Case]

    public struct Case: Codable, Equatable, Sendable {
        public var name: String
        public var base: Ledger
        public var local: Ledger
        public var remote: Ledger
        public var expected: Ledger
    }
}

/// recurring-suggestions.json (MAZ-290): the normalised title key of each title, and for each
/// ledger and day, the suggestions Penny offers. Money is integer cents; optional members are
/// absent, never null.
public struct RecurringSuggestionsFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var keys: [KeyCase]
    public var cases: [Case]

    public struct KeyCase: Codable, Equatable, Sendable {
        public var title: String
        public var key: String
    }

    public struct Case: Codable, Equatable, Sendable {
        public var name: String
        public var today: String
        public var ledger: Ledger
        public var expected: [Suggestion]
    }

    public struct Suggestion: Codable, Equatable, Sendable {
        public var id: String
        public var kind: String
        public var key: String
        public var frequency: String
        public var title: String
        public var total: Int64
        public var share: Int64
        public var participants: Int?
        public var categoryId: String
        public var accountId: String?
        public var previousShare: Int64?
        public var anchorDay: Int
        public var nextDate: String
        public var count: Int
        public var firstDate: String
        public var lastDate: String
        public var entryIds: [String]
    }
}

/// month-totals.json (MAZ-136): Left to spend versus Projected around today.
public struct MonthTotalsFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var todayCases: [TodayCase]
    public var ledgers: [String: Ledger]
    public var cases: [Case]

    /// An instant in an IANA time zone and the local date it falls on.
    public struct TodayCase: Codable, Equatable, Sendable {
        public var instant: String
        public var timeZone: String
        public var today: String
    }

    public struct Clock: Codable, Equatable, Sendable {
        public var instant: String
        public var timeZone: String
    }

    public struct Case: Codable, Equatable, Sendable {
        public var name: String
        /// A key of `ledgers`.
        public var ledger: String
        /// The local date that splits expected income from recorded income.
        public var today: String?
        public var clock: Clock?
        public var month: String
        public var expected: Expected
    }

    public struct Totals: Codable, Equatable, Sendable {
        public var income: Int64
        public var expense: Int64
        public var investment: Int64
    }

    public struct Expected: Codable, Equatable, Sendable {
        public var recorded: Totals
        public var projected: Totals
        public var expectedIncome: Int64
        public var recordedNet: Int64
        public var projectedNet: Int64
        /// Ledger entries shown as expected, sorted.
        public var expectedIds: [String]
        /// Scheduled previews, sorted.
        public var scheduledIds: [String]
    }
}

/// shared-categories.json (MAZ-286): the category a shared expense counts under in the
/// personal view.
public struct SharedCategoriesFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var month: String
    public var ledger: Ledger
    public var projection: [Row]
    public var expected: Expected

    /// The household's copy of a category, sent by value.
    public struct SharedCategory: Codable, Equatable, Sendable {
        public var name: String
        public var icon: String
        public var color: String
    }

    /// A projected shared expense in the ledger's currency, recorded (not a preview).
    public struct Row: Codable, Equatable, Sendable {
        public var id: String
        public var householdId: String
        public var date: String
        public var totalCents: Int64
        public var shareCents: Int64
        public var category: SharedCategory
    }

    public struct Expected: Codable, Equatable, Sendable {
        /// Each projection row's id to its category id in the view.
        public var categoryIds: [String: String]
        /// The categories the view adds after the ledger's own, in order.
        public var addedCategories: [Ledger.Category]
        /// The month's recorded expense share per category id.
        public var spending: [String: Int64]
    }
}

/// month-review.json (MAZ-292): the monthly recap and the month its banner shows.
public struct MonthReviewFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var ledgers: [String: Ledger]
    /// Named household projections (the server's personal projection rows).
    public var projections: [String: [ProjectedExpense]]
    public var cases: [Case]
    public var banner: [Banner]

    /// Who paid a shared expense. `deleted`: shown as "Former member", never the email.
    public struct Payer: Codable, Equatable, Sendable {
        public var email: String
        public var displayName: String?
        public var deleted: Bool?
    }

    public struct ProjectedExpense: Codable, Equatable, Sendable {
        public var id: String
        public var householdId: String
        public var householdName: String
        public var householdCurrency: String
        public var title: String
        public var date: String
        public var totalCents: Int64
        public var shareCents: Int64
        public var category: SharedCategoriesFixture.SharedCategory
        public var note: String
        public var payerUserId: String
        public var payer: Payer?
        public var paidByYou: Bool?
        public var scheduled: Bool?
        public var recurringId: String?
    }

    public struct Case: Codable, Equatable, Sendable {
        public var name: String
        /// A key of `ledgers`.
        public var ledger: String
        /// A key of `projections`.
        public var projection: String
        public var month: String
        /// The person's local date.
        public var today: String
        public var expected: Review
    }

    public struct ComparedMonth: Codable, Equatable, Sendable {
        public var month: String
        public var spent: Int64?
        public var change: Int?
    }

    public struct BiggestChange: Codable, Equatable, Sendable {
        public var key: String
        public var name: String
        public var icon: String
        public var color: String
        public var current: Int64
        public var previous: Int64
        public var change: Int64
        public var percent: Int?
    }

    public struct TopShared: Codable, Equatable, Sendable {
        public var id: String
        public var title: String
        public var categoryId: String
        public var date: String
        public var share: Int64
        public var total: Int64
        public var paidByYou: Bool?
        public var payer: Payer?
    }

    public struct Shared: Codable, Equatable, Sendable {
        public var count: Int
        public var spent: Int64
        public var top: TopShared?
    }

    public struct Split: Codable, Equatable, Sendable {
        public var count: Int
        public var total: Int64
        public var share: Int64
        public var othersPaid: Int64
    }

    public struct Run: Codable, Equatable, Sendable {
        public var start: String
        public var end: String
        public var days: Int
    }

    public struct Review: Codable, Equatable, Sendable {
        public var month: String
        public var empty: Bool
        public var spent: Int64
        public var cameIn: Int64
        public var invested: Int64
        public var leftOver: Int64
        public var previous: ComparedMonth
        public var lastYear: ComparedMonth
        public var biggestChanges: [BiggestChange]
        public var shared: Shared
        public var split: Split
        public var daysWithoutSpending: Int
        public var longestRun: Run?
    }

    /// The local date and the month whose recap banner shows then (nil: none).
    public struct Banner: Codable, Equatable, Sendable {
        public var today: String
        public var month: String?
    }
}

/// year-review.json (MAZ-292, phase 2): the year in review, and the days it's offered on.
public struct YearReviewFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    /// The person's households (`GET /api/households`), for shared trips and where shared
    /// expenses were paid.
    public var households: [Household]
    public var ledgers: [String: Ledger]
    /// Named household projections (the server's personal projection rows).
    public var projections: [String: [MonthReviewFixture.ProjectedExpense]]
    public var cases: [Case]
    public var window: [Window]

    public struct Household: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var memberCount: Int
        public var trip: Range?
    }

    public struct Range: Codable, Equatable, Sendable {
        public var startDate: String
        public var endDate: String
    }

    public struct Case: Codable, Equatable, Sendable {
        public var name: String
        /// A key of `ledgers`.
        public var ledger: String
        /// A key of `projections`.
        public var projection: String
        public var year: String
        /// The person's local date.
        public var today: String
        public var expected: Review
    }

    public struct Month: Codable, Equatable, Sendable {
        public var month: String
        public var spent: Int64
    }

    public struct Category: Codable, Equatable, Sendable {
        public var key: String
        public var name: String
        public var icon: String
        public var color: String
        public var amount: Int64
        public var share: Int
    }

    public struct Trip: Codable, Equatable, Sendable {
        public var id: String
        /// "personal" or "shared".
        public var kind: String
        public var startDate: String
        public var endDate: String
        public var days: Int
        public var share: Int64
        public var sharedWith: Int
    }

    public struct Trips: Codable, Equatable, Sendable {
        public var list: [Trip]
        public var daysAway: Int
        public var share: Int64
        public var longestId: String?
        public var costliestId: String?
    }

    public struct Payer: Codable, Equatable, Sendable {
        /// "you", or the payer's email in lower case.
        public var key: String
        public var you: Bool
        public var payer: MonthReviewFixture.Payer?
        public var count: Int
        public var householdIds: [String]
    }

    public struct Shared: Codable, Equatable, Sendable {
        public var count: Int
        public var paidByYouPercent: Int
        public var payers: [Payer]
        public var householdIds: [String]
        public var othersPaid: Int64
    }

    public struct FrequentCategory: Codable, Equatable, Sendable {
        public var key: String
        public var name: String
        public var icon: String
        public var color: String
        public var count: Int
    }

    public struct Facts: Codable, Equatable, Sendable {
        public var daysWithoutSpending: Int
        public var longestRun: MonthReviewFixture.Run?
        public var expensesRecorded: Int
        public var perWeek: Int
        /// ISO weekday, 1 Monday … 7 Sunday.
        public var busiestWeekday: Int?
        public var mostFrequentCategory: FrequentCategory?
    }

    public struct Review: Codable, Equatable, Sendable {
        public var year: String
        public var empty: Bool
        public var from: String?
        public var to: String
        public var spent: Int64
        public var months: [Month]
        public var busiestMonth: Month?
        public var monthlyAverage: Int64
        public var topCategories: [Category]
        public var trips: Trips
        public var shared: Shared
        public var facts: Facts
    }

    /// A local date, the year the year in review is offered for then, and the year of the
    /// January banner (nil: none).
    public struct Window: Codable, Equatable, Sendable {
        public var today: String
        public var year: String?
        public var banner: String?
    }
}

/// shared-splits.json
public struct SharedSplitsFixture: Codable, Equatable, Sendable {
    public var description: String
    public var cases: [Case]

    public struct Case: Codable, Equatable, Sendable {
        public var name: String
        public var totalCents: Int64
        public var input: SplitInput
        public var expected: [Share]?
        public var error: Bool?
    }
}

public struct SplitInput: Codable, Equatable, Sendable {
    public var mode: String
    public var memberIds: [String]?
    public var allocations: [Allocation]?

    public struct Allocation: Codable, Equatable, Sendable {
        public var userId: String
        public var amountCents: Int64?
        public var percentBasisPoints: Int64?
    }
}

public struct Share: Codable, Equatable, Sendable {
    public var userId: String
    public var amountCents: Int64
}

/// parity-cases.json
public struct ParityFixture: Codable, Equatable, Sendable {
    public var money: [Money]
    public var personalShares: [PersonalShare]
    public var dates: [DateCase]
    public var sharedSplits: [SplitCase]
    public var merge: Merge

    public struct Money: Codable, Equatable, Sendable {
        public var input: String
        public var cents: Int64?
        public var error: String?
    }

    public struct PersonalShare: Codable, Equatable, Sendable {
        public var total: Int64
        public var mode: String
        public var input: String
        public var share: Int64?
        public var error: String?
    }

    public struct DateCase: Codable, Equatable, Sendable {
        public var date: String
        public var frequency: String
        public var anchorDay: Int
        public var next: String
    }

    public struct SplitCase: Codable, Equatable, Sendable {
        public var totalCents: Int64
        public var input: SplitInput
        public var expected: [Share]
    }

    public struct Merge: Codable, Equatable, Sendable {
        public var base: JSONValue
        public var local: JSONValue
        public var remote: JSONValue
        public var expected: JSONValue
    }
}

/// manifest.json
public struct FixtureManifest: Codable, Equatable, Sendable {
    public var version: Int
    public var description: String
    public var fixtures: [Entry]

    public struct Entry: Codable, Equatable, Sendable {
        public var file: String
        public var sha256: String
        public var generatedBy: String?
        /// Per language: suite paths, or a sentence naming why not (yet).
        public var consumers: [String: JSONValue]
    }
}

/// currency.json (MAZ-151, contract 2.4.0): entries in several currencies.
public struct CurrencyFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var currencies: [CurrencyInfo]
    public var homeCurrencies: [String]
    public var parse: [ParseCase]
    public var rates: [RateCase]
    public var conversions: [ConversionCase]
    public var crossRates: [CrossRateCase]
    public var rateDates: [RateDateCase]
    public var entryAmounts: [EntryAmountsCase]
    public var reconversions: [ReconversionCase]
    public var ledgers: [LedgerCase]

    public struct CurrencyInfo: Codable, Equatable, Sendable {
        public var code: String
        public var name: String
        public var minorUnits: Int
    }

    /// Exactly one of `amount` (minor units) and `error` is present.
    public struct ParseCase: Codable, Equatable, Sendable {
        public var input: String
        public var currency: String
        public var amount: Int64?
        public var error: String?
    }

    /// Exactly one of `rate` (canonical) and `error` is present.
    public struct RateCase: Codable, Equatable, Sendable {
        public var input: String
        public var rate: String?
        public var error: String?
    }

    public struct ConversionCase: Codable, Equatable, Sendable {
        public var amount: Int64
        public var from: String
        public var rate: String
        public var home: String
        public var converted: Int64
    }

    /// A nil `rate` is a cross rate that rounds to zero.
    public struct CrossRateCase: Codable, Equatable, Sendable {
        public var fromPerBase: String
        public var toPerBase: String
        public var rate: String?
    }

    public struct RateDateCase: Codable, Equatable, Sendable {
        public struct Expected: Codable, Equatable, Sendable {
            public var date: String
            public var provisional: Bool
        }

        public var published: [String]
        public var date: String
        public var expected: Expected?
    }

    public struct EntryAmountsCase: Codable, Equatable, Sendable {
        public struct Expected: Codable, Equatable, Sendable {
            public var originalAmount: Int64
            public var total: Int64
            public var share: Int64
        }

        public var amount: String
        public var currency: String
        public var home: String
        public var rate: String?
        public var mode: String
        public var split: String
        public var expected: Expected?
        public var error: String?
    }

    /// The amount fields of an entry before and after `reconvertEntry`.
    public struct ReconvertedEntry: Codable, Equatable, Sendable {
        public var kind: String
        public var total: Int64
        public var share: Int64
        public var participants: Int?
        public var originalAmount: Int64?
        public var originalCurrency: String?
        public var rate: String?
        public var rateStatus: String?
        public var rateDate: String?
    }

    public struct NextRate: Codable, Equatable, Sendable {
        public var rate: String
        public var rateStatus: String
        public var rateDate: String?
    }

    public struct ReconversionCase: Codable, Equatable, Sendable {
        public var home: String
        public var entry: ReconvertedEntry
        public var next: NextRate
        public var expected: ReconvertedEntry
    }

    /// A whole ledger and whether the write schema accepts it.
    public struct LedgerCase: Codable, Equatable, Sendable {
        public var name: String
        public var ledger: Ledger
        public var valid: Bool
    }
}
