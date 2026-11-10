/// The rows of one server search across its pages. Each result key appears once, so a shared
/// expense (or an entry) that moves between pages while someone pages through results is
/// never shown twice; the first position wins. A page for another query or account resets
/// nothing and is refused: start a new `SearchResults` for a new search.
public struct SearchResults: Equatable, Sendable {
    public let scope: AccountScope
    public let request: SearchRequest
    public private(set) var items: [SearchItem] = []
    public private(set) var hasMore = false
    private var keys: Set<String> = []

    public init(first page: SearchPage) {
        scope = page.scope
        request = page.request
        append(page)
    }

    /// Adds a following page. Returns false (and adds nothing) for a page of another search.
    @discardableResult
    public mutating func append(_ page: SearchPage) -> Bool {
        guard page.scope == scope, page.request == request else { return false }
        for item in page.response.items where keys.insert(item.key).inserted { items.append(item) }
        hasMore = page.response.nextCursor != nil
        return true
    }
}
