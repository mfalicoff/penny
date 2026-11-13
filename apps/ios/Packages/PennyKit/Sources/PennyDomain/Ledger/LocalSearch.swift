/// The local search the current app uses for offline, pending and demo data
/// (search-cases.json `substringCases` and `pendingCases`); v2 `searchMatcher` in
/// src/domain/search.ts (docs/reference/domain-rules.md).
///
/// A row matches when the query, trimmed with JavaScript's `trim` and lowercased, is an exact
/// substring of its one search document, `"{title} {note} {category name} {account name}"`
/// lowercased. Every screen (Home, Activity, whole-ledger search) uses the same rule. Joining
/// the fields with single spaces keeps cross-field matches ("beans morning" finds title
/// "Coffee beans" with note "Morning"), but a query cannot skip a field ("lunch  with" with
/// two spaces does not find "Lunch" / "With Alex"). There is no accent folding ("cafe" does
/// not find "Café"), and `%`, `_` and `\` are ordinary characters. The folded normalization of
/// server search v1 (`foldCases`, MAZ-121) is not applied here: the native entry screens use
/// `SearchText` and `FoldedSearchIndex` (MAZ-73), and typo and meaning tiers need the server.
public enum LocalSearch {
    /// The haystack's fields, in document order. Missing fields are empty.
    public static func matches(
        query: String, title: String, note: String, categoryName: String, accountName: String
    ) -> Bool {
        JavaScriptText.includes(
            document(title: title, note: note, categoryName: categoryName, accountName: accountName), needle(query))
    }

    /// The query as matched: trimmed, then lowercased. Compute it once per query.
    static func needle(_ query: String) -> String { JavaScriptText.lowercase(JavaScriptText.trim(query)) }

    /// The fields joined with single spaces, lowercased.
    static func document(title: String, note: String, categoryName: String, accountName: String) -> String {
        JavaScriptText.lowercase("\(title) \(note) \(categoryName) \(accountName)")
    }

    /// Whether to show local results instead of server pages. With pending local changes, or
    /// offline, the client searches its complete
    /// local result set, so an unsynced create, edit or delete can never be hidden or revived by
    /// a server page. It never mixes local rows into server pages (docs/reference/search.md).
    public static func searchesLocally(hasPendingChanges: Bool, isOnline: Bool) -> Bool {
        hasPendingChanges || !isOnline
    }
}

extension LedgerReport {
    /// `LocalSearch.matches` over a report row: shared rows search their shared category, and
    /// the account name only when the row names one of the caller's accounts (only the payer's
    /// shares carry one).
    public func matches(_ entry: ReportEntry, query: String) -> Bool { matcher(query)(entry) }

    /// One predicate per query (v2 `searchMatcher`): the query is trimmed and lowercased once.
    func matcher(_ query: String) -> (ReportEntry) -> Bool {
        let needle = LocalSearch.needle(query)
        return { entry in
            JavaScriptText.includes(
                LocalSearch.document(
                    title: entry.title, note: entry.note, categoryName: categoryName(entry.categoryId),
                    accountName: accountName(entry.accountId)), needle)
        }
    }

    /// v2 `searchEntries`: the recorded entries of the whole report (personal and shared, any
    /// date, never previews) that match the query, kind and day, newest first then id.
    public func search(_ query: String, kind: EntryKind? = nil, day: CalendarDate? = nil) -> [ReportEntry] {
        let matches = matcher(query)
        return recorded.filter { (kind == nil || $0.kind == kind) && (day == nil || $0.date == day) && matches($0) }
            .sorted(by: ReportEntry.newestFirst)
    }
}
