import Foundation

/// The search v1 text normalization (docs/migration/search.md, "Text normalization";
/// `contracts/fixtures/search-cases.json` `foldCases`), shared with the server and the web:
///
/// 1. Unicode NFKD decomposition.
/// 2. Remove every nonspacing mark (`Mn`), so "cafe" matches "Café".
/// 3. Locale-independent lowercase.
/// 4. Final sigma `ς` becomes `σ`, and `ß` becomes `ss`.
/// 5. Each run of Unicode whitespace becomes one space, then the ends are trimmed.
///
/// The legacy substring rule (`LocalSearch`) stays for the legacy fixtures; the native entry
/// screens search pending, offline and demo data with this normalization and the server's
/// literal tiers 1–2 only (`FoldedSearchIndex`), MAZ-73.
public enum SearchText {
    public static func normalize(_ text: String) -> String {
        var marksRemoved = String.UnicodeScalarView()
        for scalar in text.decomposedStringWithCompatibilityMapping.unicodeScalars
        where scalar.properties.generalCategory != .nonspacingMark {
            marksRemoved.append(scalar)
        }
        let lowered = String(marksRemoved).lowercased()
        var result = String.UnicodeScalarView()
        var pendingSpace = false
        for scalar in lowered.unicodeScalars {
            if scalar.properties.isWhitespace {
                pendingSpace = true
                continue
            }
            if pendingSpace, !result.isEmpty { result.append(" ") }
            pendingSpace = false
            switch scalar {
            case "\u{03C2}": result.append("\u{03C3}")
            case "\u{00DF}":
                result.append("s")
                result.append("s")
            default: result.append(scalar)
            }
        }
        return String(result)
    }
}

/// Which local tier a row matched, as the server names tiers 1 and 2.
public enum FoldedMatch: Hashable, Sendable {
    /// The normalized title contains the query.
    case title
    /// The normalized document ("title note category account") contains the query.
    case text
}

/// Local search over this device's ledger (pending, offline and demo data) with the shared
/// normalization and the server's literal tiers only: no typo or meaning matching, which need
/// the server. An empty query matches every row. The document is the server's: title, note,
/// category name and account name joined with single spaces.
///
/// Normalizing 100,000 documents on every keystroke is too slow, so the index normalizes each
/// row once per ledger and a query is then a code-unit substring scan.
public struct FoldedSearchIndex: Sendable {
    struct Document: Sendable {
        let title: [UInt16]
        let text: [UInt16]
    }

    let documents: [String: Document]

    /// An empty index: enough when there is no query (every row matches).
    public init() { documents = [:] }

    /// Indexes every recorded row of `report` (personal entries and any shared rows it holds).
    public init(_ report: LedgerReport) {
        var documents: [String: Document] = [:]
        documents.reserveCapacity(report.recorded.count)
        for entry in report.recorded {
            let title = SearchText.normalize(entry.title)
            let text = SearchText.normalize(
                "\(entry.title) \(entry.note) \(report.categoryName(entry.categoryId)) \(report.accountName(entry.accountId))"
            )
            documents[entry.id] = Document(title: Array(title.utf16), text: Array(text.utf16))
        }
        self.documents = documents
    }

    /// The query as the index matches it: normalized, as UTF-16 code units. Compute it once.
    public static func needle(_ query: String) -> [UInt16] { Array(SearchText.normalize(query).utf16) }

    /// The tier `entry` matches `needle` with, or nil. Rows the index has never seen match by
    /// title only.
    public func match(_ entry: ReportEntry, needle: [UInt16]) -> FoldedMatch? {
        guard !needle.isEmpty else { return .title }
        let document =
            documents[entry.id] ?? Document(title: Array(SearchText.normalize(entry.title).utf16), text: [])
        if Self.contains(document.title, needle) { return .title }
        if Self.contains(document.text, needle) { return .text }
        return nil
    }

    static func contains(_ haystack: [UInt16], _ needle: [UInt16]) -> Bool {
        guard !needle.isEmpty else { return true }
        guard haystack.count >= needle.count else { return false }
        let first = needle[0]
        for start in 0...(haystack.count - needle.count)
        where haystack[start] == first && haystack[start..<(start + needle.count)].elementsEqual(needle) {
            return true
        }
        return false
    }
}
