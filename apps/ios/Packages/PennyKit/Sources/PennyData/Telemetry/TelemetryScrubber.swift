import Foundation

/// The privacy rules for what the app reports (MAZ-129), the same as the web app's
/// (`apps/web/src/telemetry/scrub.ts`) and the API's, which scrubs everything again. Nothing
/// that leaves the device may carry credentials, codes, emails, search text, ledger contents or
/// amounts.
///
/// - URLs keep their origin and the shape of their path only. A segment survives when it is a
///   lowercase word (`households`, `password-reset`) or an API version (`v1`); anything else, such
///   as an entry id, becomes `:id`. Query strings and fragments are dropped.
/// - Free text (error messages) keeps its wording, with emails, quoted text and numbers redacted
///   and URLs in it scrubbed as above. Hex addresses (`0x1a2b`) survive, so stack frames can be
///   symbolicated.
public enum TelemetryScrubber {
    private static let maxSegmentLength = 32

    /// Scrubs one absolute or root-relative URL; other strings are returned unchanged.
    public static func url(_ value: String) -> String {
        if value.hasPrefix("/"), !value.hasPrefix("//") {
            let end = value.firstIndex(where: { $0 == "?" || $0 == "#" }) ?? value.endIndex
            return path(String(value[..<end]))
        }
        guard value.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil else {
            return value
        }
        guard let components = URLComponents(string: value), let scheme = components.scheme,
            let host = components.host
        else { return "<url>" }
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme.lowercased())://\(host.lowercased())\(port)" + path(components.percentEncodedPath)
    }

    /// A path with every segment that isn't a word or an API version replaced by `:id`.
    public static func path(_ path: String) -> String {
        path.split(separator: "/", omittingEmptySubsequences: false)
            .map { segment -> String in
                let text = String(segment)
                if text.isEmpty { return text }
                if matches(word, text), text.count <= maxSegmentLength, !matches(hex, text) { return text }
                if matches(apiVersion, text) { return text }
                return ":id"
            }
            .joined(separator: "/")
    }

    /// Redacts user content from free text, keeping its wording.
    public static func text(_ text: String) -> String {
        var result = replace(urlInText, in: text) { url($0) }
        result = codeInText.stringByReplacingMatches(
            in: result, range: NSRange(result.startIndex..., in: result), withTemplate: "$1$2=<code>")
        result = replace(email, in: result) { _ in "<email>" }
        result = replace(quoted, in: result) { _ in "<text>" }
        return replace(number, in: result) { _ in "<n>" }
    }

    // ICU expressions (Swift's Regex has no lookbehind), the same patterns as the web and the API.
    private static let word = expression("^[a-z]+(?:[-_][a-z]+)*$")
    private static let hex = expression("^[a-f]{8,}$")
    private static let apiVersion = expression("^v\\d{1,2}$")
    private static let urlInText = expression("\\bhttps?://[^\\s\"'<>`]+")
    private static let codeInText = expression("([?#&])(code|token|state)=[^\\s&#\"'<>`]+", caseInsensitive: true)
    private static let email = expression("[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+")
    private static let quoted = expression("\"[^\"]*\"|'[^']*'|`[^`]*`|“[^”]*”")
    private static let number = expression("(?<![\\w:/.-])[-+]?\\d[\\d,.]*(?!\\w)")

    private static func expression(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        do {
            return try NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
        } catch {
            preconditionFailure("Invalid telemetry scrubbing pattern \(pattern)")
        }
    }

    private static func matches(_ expression: NSRegularExpression, _ text: String) -> Bool {
        expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func replace(
        _ expression: NSRegularExpression, in text: String, with replacement: (String) -> String
    ) -> String {
        var result = ""
        var last = text.startIndex
        for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text) else { continue }
            result += text[last..<range.lowerBound]
            result += replacement(String(text[range]))
            last = range.upperBound
        }
        return result + text[last...]
    }
}
