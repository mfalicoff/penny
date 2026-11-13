/// full-stack-seeds.json: steps stay open JSON (they are HTTP actions); the scenario,
/// search expectations and pending edits are typed.
public struct SeedFixture: Codable, Equatable, Sendable {
    public var version: Int
    public var description: String
    public var scenarios: [Scenario]

    public struct Scenario: Codable, Equatable, Sendable {
        public var name: String
        public var summary: String
        public var clock: String
        public var users: [String]
        public var steps: [[String: JSONValue]]
        public var searchExpectations: [SearchExpectation]?
        public var pendingEdits: PendingEdits?
        /// Legacy-versus-.NET comparison requests (differential scenario).
        public var probes: [Probe]?
        public var knownDifferences: [KnownDifference]?
    }

    public struct Probe: Codable, Equatable, Sendable {
        public var name: String
        public var `as`: String?
        public var method: String
        public var path: String
        public var body: JSONValue?
    }

    public struct KnownDifference: Codable, Equatable, Sendable {
        public var probe: String
        public var path: String
        public var reason: String
    }

    public struct SearchExpectation: Codable, Equatable, Sendable {
        public var `as`: String
        public var request: Request
        public var keys: [String]
        public var matches: [String?]
        public var meaningAllowedAfter: Bool
        public var excludes: [String]
        public var why: String

        public struct Request: Codable, Equatable, Sendable {
            public var query: String
        }
    }

    public struct PendingEdits: Codable, Equatable, Sendable {
        public var `as`: String
        public var description: String
        public var create: [Ledger.Entry]
        public var edit: [Edit]
        public var delete: [String]
        public var localSearch: [LocalSearch]

        public struct Edit: Codable, Equatable, Sendable {
            public var id: String
            public var patch: [String: JSONValue]
        }

        public struct LocalSearch: Codable, Equatable, Sendable {
            public var query: String
            public var expectedIds: [String]
        }
    }
}

/// redesign-states.json
public struct RedesignStates: Codable, Equatable, Sendable {
    public var version: Int
    public var description: String
    public var clock: String
    public var palettes: [String]
    public var totals: [String: Totals]
    public var states: [State]

    public struct Totals: Codable, Equatable, Sendable {
        public var description: String
        /// The person's clock and IANA time zone; `today` is their local date (MAZ-136).
        public var clock: String
        public var timeZone: String
        public var today: String
        public var recorded: Amounts
        /// Ledger income dated after `today`: in `projected`, not in `recorded`.
        public var expected: [Expected]
        public var scheduled: [Scheduled]
        public var projected: Amounts
    }

    public struct Expected: Codable, Equatable, Sendable {
        public var title: String
        public var date: String
        public var shareCents: Int64
    }

    public struct Amounts: Codable, Equatable, Sendable {
        public var expenseCents: Int64
        public var incomeCents: Int64
        public var investmentCents: Int64
    }

    public struct Scheduled: Codable, Equatable, Sendable {
        public var source: String
        public var title: String
        public var date: String
        public var shareCents: Int64
    }

    public struct State: Codable, Equatable, Sendable {
        public var specimen: String
        public var platform: String
        public var appearances: [String]
        public var scenario: String?
        public var `as`: String?
        public var client: String?
        public var oidc: Bool?
        public var view: String
        public var totals: String?
        public var month: String?
        public var search: Search?
        public var blockedBy: String?
        public var fault: [String: JSONValue]?
        public var expect: Expect?
        public var staleWrite: StaleWrite?

        public struct Search: Codable, Equatable, Sendable {
            public var query: String
        }

        public struct Expect: Codable, Equatable, Sendable {
            public var status: Int
            public var retryStatus: Int
        }

        public struct StaleWrite: Codable, Equatable, Sendable {
            public var method: String
            public var path: String
            public var requests: [Request]

            public struct Request: Codable, Equatable, Sendable {
                public var body: [String: JSONValue]
                public var expectStatus: Int
                public var expectError: String?
            }
        }
    }
}
