/// The local search the current app uses for offline, pending and demo data
/// (search-cases.json `substringCases` and `pendingCases`).
///
/// A row matches when the query, lowercased, is an exact substring of
/// `"{title} {note} {category name} {account name}"` lowercased. Activity trims the query
/// first (legacy `selectTransactions`); Home does not (legacy `selectOverview`), so there a
/// leading or trailing space is part of the substring. Joining the fields keeps cross-field
/// matches ("beans morning" finds title "Coffee beans" with note "Morning"). There is no
/// accent folding ("cafe" does not find "Café"), and `%`, `_` and `\` are ordinary
/// characters. The folded normalization and typo/meaning tiers of server search v1
/// (`foldCases`, MAZ-121) are not applied here; MAZ-73 owns them on iOS.
public enum LocalSearch {
    /// The haystack's fields, in the legacy order. Missing fields are empty.
    /// - Parameter trimsQuery: whether to trim the query with JavaScript's `trim` first
    ///   (Activity and offline search), or keep it as typed (Home's month list).
    public static func matches(
        query: String, title: String, note: String, categoryName: String, accountName: String,
        trimsQuery: Bool = true
    ) -> Bool {
        let needle = JavaScriptText.lowercase(trimsQuery ? JavaScriptText.trim(query) : query)
        let haystack = JavaScriptText.lowercase("\(title) \(note) \(categoryName) \(accountName)")
        return JavaScriptText.includes(haystack, needle)
    }

    /// Whether to show local results instead of server pages. With pending local changes, or
    /// offline, or against a server without search v1 (404), the client searches its complete
    /// local result set, so an unsynced create, edit or delete can never be hidden or revived by
    /// a server page. It never mixes local rows into server pages (docs/migration/search.md).
    public static func searchesLocally(hasPendingChanges: Bool, isOnline: Bool, serverHasSearch: Bool) -> Bool {
        hasPendingChanges || !isOnline || !serverHasSearch
    }
}

extension LedgerReport {
    /// `LocalSearch.matches` over a report row: shared rows search their shared category, and
    /// the account name only when the row names one of the caller's accounts (only the payer's
    /// shares carry one).
    public func matches(_ entry: ReportEntry, query: String, trimsQuery: Bool = true) -> Bool {
        LocalSearch.matches(
            query: query, title: entry.title, note: entry.note, categoryName: categoryName(entry.categoryId),
            accountName: accountName(entry.accountId), trimsQuery: trimsQuery)
    }
}
