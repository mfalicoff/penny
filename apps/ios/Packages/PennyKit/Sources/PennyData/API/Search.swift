public import Foundation

// Search v1 wire types (MAZ-121, docs/migration/search.md): `POST /api/v1/search/transactions`.

public enum SearchSource: String, Codable, Equatable, Sendable {
    case personal
    case shared
    case all
}

public enum SearchSort: String, Codable, Equatable, Sendable {
    case relevance
    case dateDescending = "date-desc"
    case dateAscending = "date-asc"
    case amountDescending = "amount-desc"
    case amountAscending = "amount-asc"
}

/// Which tier matched; nil for an empty query.
public enum SearchMatch: String, Codable, Equatable, Sendable {
    case title
    case text
    case typo
    case meaning
}

/// The search request. Optional members are omitted from the JSON when nil, so the server
/// applies its defaults. `userId` and other members are not part of the contract and the
/// server rejects them, so none exist here.
public struct SearchRequest: Codable, Equatable, Sendable {
    public static let maxQueryLength = 200
    public static let maxCursorLength = 2048
    public static let pageSizeRange = 1...100

    public var query: String?
    public var from: String?
    public var to: String?
    public var kind: WireEntryKind?
    public var source: SearchSource?
    public var sort: SearchSort?
    public var pageSize: Int?
    public var cursor: String?

    public init(
        query: String? = nil, from: String? = nil, to: String? = nil, kind: WireEntryKind? = nil,
        source: SearchSource? = nil, sort: SearchSort? = nil, pageSize: Int? = nil, cursor: String? = nil
    ) {
        self.query = query
        self.from = from
        self.to = to
        self.kind = kind
        self.source = source
        self.sort = sort
        self.pageSize = pageSize
        self.cursor = cursor
    }

    /// The same request without a paging position: what a cursor is bound to.
    var withoutCursor: SearchRequest {
        var copy = self
        copy.cursor = nil
        return copy
    }

    /// Checks the contract's limits before anything is sent, so a malformed query or cursor
    /// fails locally with a field name instead of a round trip. The server stays the
    /// authority (cursors in particular are opaque and checked there).
    func validate() throws(APIError) {
        if let query {
            // The server trims (ECMAScript trim) and then counts UTF-16 code units.
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.utf16.count > Self.maxQueryLength { throw .invalidRequest(.invalidField("query")) }
        }
        if let from, !CalendarDate.isValid(from) { throw .invalidRequest(.invalidField("from")) }
        if let to, !CalendarDate.isValid(to) { throw .invalidRequest(.invalidField("to")) }
        if let from, let to, from > to { throw .invalidRequest(.invalidField("from")) }
        if let pageSize, !Self.pageSizeRange.contains(pageSize) { throw .invalidRequest(.invalidField("pageSize")) }
        if let cursor, cursor.isEmpty || cursor.utf16.count > Self.maxCursorLength {
            throw .invalidRequest(.invalidField("cursor"))
        }
    }

    /// The query as sent: trimmed, as the server does.
    var normalizedForSending: SearchRequest {
        var copy = self
        copy.query = query?.trimmingCharacters(in: .whitespacesAndNewlines)
        return copy
    }
}

/// One result: a personal entry or a shared expense. The `key` is unique and is what a
/// list should identify rows by, never the title.
public struct SearchItem: Codable, Equatable, Sendable {
    public enum Payload: Equatable, Sendable {
        case personal(WireEntry)
        case shared(WireProjectedExpense)
    }

    public var key: String
    public var match: SearchMatch?
    public var payload: Payload

    public var source: SearchSource {
        switch payload {
        case .personal: .personal
        case .shared: .shared
        }
    }

    public init(key: String, match: SearchMatch?, payload: Payload) {
        self.key = key
        self.match = match
        self.payload = payload
    }

    private enum CodingKeys: String, CodingKey {
        case key, source, match, entry
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let key = try container.decode(String.self, forKey: .key)
        let source = try container.decode(SearchSource.self, forKey: .source)
        match = try container.decodeIfPresent(SearchMatch.self, forKey: .match)
        switch source {
        case .personal:
            guard key.hasPrefix("personal:"), key.count > "personal:".count else {
                throw DecodingError.dataCorruptedError(forKey: .key, in: container, debugDescription: "key")
            }
            payload = .personal(try container.decode(WireEntry.self, forKey: .entry))
        case .shared:
            guard key.hasPrefix("shared:"), key.count > "shared:".count else {
                throw DecodingError.dataCorruptedError(forKey: .key, in: container, debugDescription: "key")
            }
            payload = .shared(try container.decode(WireProjectedExpense.self, forKey: .entry))
        case .all:
            throw DecodingError.dataCorruptedError(forKey: .source, in: container, debugDescription: "source")
        }
        self.key = key
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(key, forKey: .key)
        // The contract requires `match`, null when no tier applies.
        try container.encode(match, forKey: .match)
        switch payload {
        case .personal(let entry):
            try container.encode(SearchSource.personal, forKey: .source)
            try container.encode(entry, forKey: .entry)
        case .shared(let expense):
            try container.encode(SearchSource.shared, forKey: .source)
            try container.encode(expense, forKey: .entry)
        }
    }
}

public struct SearchResponse: Codable, Equatable, Sendable {
    public var version: Int
    public var items: [SearchItem]
    /// Authorized matching results, each counted once. Not a money total.
    public var totalCount: Int
    /// Opaque; pass it back unchanged with the same query, filters and sort.
    public var nextCursor: String?

    public init(version: Int, items: [SearchItem], totalCount: Int, nextCursor: String?) {
        self.version = version
        self.items = items
        self.totalCount = totalCount
        self.nextCursor = nextCursor
    }

    private enum CodingKeys: String, CodingKey {
        case version, items, totalCount, nextCursor
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(items, forKey: .items)
        try container.encode(totalCount, forKey: .totalCount)
        try container.encode(nextCursor, forKey: .nextCursor)
    }
}
