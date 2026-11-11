import Foundation
import PennyAccessibility
import Testing

/// Keeps the identifiers the UI tests use (`AccessibilityID`) and the ones the views set in
/// step, so a renamed identifier fails here in seconds instead of in a simulator run.
@Suite("Accessibility identifiers")
struct AccessibilityIDTests {
    /// `.accessibilityIdentifier("…")` literals in the screen modules, up to the first
    /// interpolation, with the file they came from.
    static func viewLiterals() throws -> [(literal: String, file: String)] {
        var found: [(String, String)] = []
        // The rest of the line after the call, then each string literal in it (escapes such as
        // `\(` included), cut at the first interpolation.
        let call = try Regex(#"accessibilityIdentifier\([^\n]*"#)
        let literal = try Regex(#""(?:[^"\\]|\\.)*""#)
        for module in ["PennyUI", "PennyDesign"] {
            for file in try Repository.swiftFiles(in: "apps/ios/Packages/PennyKit/Sources/\(module)") {
                let text = try String(contentsOf: file, encoding: .utf8)
                for match in text.matches(of: call) {
                    let arguments = String(text[match.range])
                    for value in arguments.matches(of: literal) {
                        let body = arguments[value.range].dropFirst().dropLast()
                        let fixed = body.range(of: "\\(").map { body[..<$0.lowerBound] } ?? body
                        found.append((String(fixed), file.lastPathComponent))
                    }
                }
            }
        }
        return found
    }

    @Test("whenListed_FixedIdentifiers_ShouldFollowTheConventionAndBeUnique")
    func convention() throws {
        let pattern = try Regex(AccessibilityID.pattern)
        for id in AccessibilityID.fixed {
            #expect(id.wholeMatch(of: pattern) != nil, "\(id) does not follow <area>.<element>")
        }
        #expect(Set(AccessibilityID.fixed).count == AccessibilityID.fixed.count, "duplicate identifiers")
        for prefix in AccessibilityID.dynamicPrefixes {
            #expect("\(prefix)x".wholeMatch(of: pattern) != nil, "\(prefix) is not a valid prefix")
        }
    }

    @Test("whenBuilt_DynamicIdentifiers_ShouldUseTheModelIdOrRawValue")
    func dynamic() {
        #expect(AccessibilityID.Row.entry("t-1") == "entry.t-1")
        #expect(AccessibilityID.Tab.tab("activity") == "tab.activity")
        #expect(AccessibilityID.Settings.currency("EUR") == "currency.EUR")
        #expect(AccessibilityID.Settings.row("currency") == "settings.currency")
        #expect(AccessibilityID.Sidebar.item("activity") == "sidebar.activity")
    }

    @Test("whenViewsSetIdentifiers_EveryLiteral_ShouldFollowTheConvention")
    func viewsFollowConvention() throws {
        // The literal part may end in a dot when a model id is interpolated after it.
        let prefix = try Regex(#"^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*\.?$"#)
        let literals = try Self.viewLiterals()
        #expect(!literals.isEmpty)
        for (literal, file) in literals {
            #expect(literal.wholeMatch(of: prefix) != nil, "\(file): \"\(literal)\" does not follow <area>.<element>")
        }
    }

    @Test("whenUITestsUseAnIdentifier_TheViews_ShouldSetIt")
    func noDrift() throws {
        let literals = Set(try Self.viewLiterals().map(\.literal))
        for id in AccessibilityID.fixed {
            #expect(literals.contains(id), "\(id) is in AccessibilityID but no view sets it")
        }
        for prefix in AccessibilityID.dynamicPrefixes {
            #expect(literals.contains(prefix), "no view sets an identifier starting with \(prefix)")
        }
    }
}

enum Repository {
    // apps/ios/Packages/PennyKit/Tests/PennyAccessibilityTests/AccessibilityIDTests.swift -> root
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()

    static func swiftFiles(in path: String) throws -> [URL] {
        let directory = root.appending(path: path, directoryHint: .isDirectory)
        guard let enumerator = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil) else {
            return []
        }
        return enumerator.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
            .sorted { $0.path < $1.path }
    }
}
