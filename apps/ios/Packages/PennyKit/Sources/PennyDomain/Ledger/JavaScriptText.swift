/// Text rules that must equal what the web app (JavaScript) and the .NET server do, because
/// every side validates and searches the same strings (docs/reference/ledger.md).
enum JavaScriptText {
    /// ECMAScript `WhiteSpace` and `LineTerminator`: tab, VT, FF, space, no-break space, BOM,
    /// every Unicode "Zs" space, LF, CR, LS and PS. Unlike Swift's `whitespacesAndNewlines`,
    /// it excludes U+0085 and includes U+FEFF.
    static func isWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            true
        default:
            false
        }
    }

    /// `String.prototype.trim`.
    static func trim(_ text: String) -> String {
        var scalars = Substring(text).unicodeScalars
        while let first = scalars.first, isWhitespace(first) { scalars.removeFirst() }
        while let last = scalars.last, isWhitespace(last) { scalars.removeLast() }
        return String(scalars)
    }

    /// `String.prototype.length`: UTF-16 code units, which the wire limits count.
    static func length(_ text: String) -> Int { text.utf16.count }

    /// .NET `LedgerText.IsStorable`: PostgreSQL text cannot hold NUL or unpaired surrogates,
    /// so the server refuses both. A Swift `String` is always well-formed Unicode: it cannot
    /// hold an unpaired surrogate at all (bridging from `NSString` repairs one to U+FFFD, and
    /// `JSONDecoder` refuses a lone `\uD83D` escape), so only the NUL half can occur here.
    static func isStorable(_ text: String) -> Bool { !text.utf16.contains(0) }

    /// `String.prototype.toLowerCase`: locale-independent full Unicode lowercase. Swift's
    /// `lowercased()` applies the same per-scalar mappings; it differs only in the
    /// context-dependent Greek final sigma, which JavaScript lowercases to "ς" and Swift to "σ".
    static func lowercase(_ text: String) -> String { text.lowercased() }

    /// `haystack.includes(needle)`: an exact UTF-16 code-unit substring match. Swift's
    /// `String.contains` compares by canonical equivalence (a composed "é" would match a
    /// decomposed one), which JavaScript's `includes` never does.
    static func includes(_ haystack: String, _ needle: String) -> Bool {
        let needle = Array(needle.utf16)
        guard !needle.isEmpty else { return true }
        let haystack = Array(haystack.utf16)
        guard haystack.count >= needle.count else { return false }
        for start in 0...(haystack.count - needle.count)
        where haystack[start] == needle[0] && haystack[start..<(start + needle.count)].elementsEqual(needle) {
            return true
        }
        return false
    }

    /// Ordinal UTF-16 code-unit order, the deterministic tie-break for ids. (`localeCompare`
    /// would depend on the device's ICU data; for the ASCII ids the clients generate the two
    /// agree on letters and digits.)
    static func ordinalLess(_ lhs: String, _ rhs: String) -> Bool {
        lhs.utf16.lexicographicallyPrecedes(rhs.utf16)
    }
}
