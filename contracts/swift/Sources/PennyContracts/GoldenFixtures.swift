/// money.json
public struct MoneyFixture: Codable, Equatable, Sendable {
    public var generator: String
    public var description: String
    public var parse: [ParseCase]
    public var personalShares: [ShareCase]
    public var ledgerAmounts: [AmountCase]

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

/// ledger-upgrades.json
public struct LedgerUpgradeCase: Codable, Equatable, Sendable {
    public var name: String
    public var input: Ledger
    public var expected: Ledger
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
