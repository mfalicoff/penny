import Foundation
import PennyDesign
import Testing

@Suite("Design tokens match contracts/design-baseline.json")
struct TokenBaselineTests {
    let tokens: [String: Any]

    init() throws {
        tokens = try #require(try Repository.json("contracts/design-baseline.json")["tokens"] as? [String: Any])
    }

    /// Tokens the baseline has but the app deliberately draws with the system material.
    static let cssOnly: Set<String> = ["glass", "glass-edge"]

    @Test("whenComparedWithBaseline_Palette_ShouldMatchEveryLightAndDarkValue")
    func palette() throws {
        let palettes = try #require(tokens["palettes"] as? [String: [String: String]])
        #expect(Set(palettes.keys) == ["light", "dark"], "Only light and dark appearances (MAZ-132)")
        let light = try #require(palettes["light"]), dark = try #require(palettes["dark"])

        #expect(Set(light.keys).subtracting(Self.cssOnly) == Set(PaletteToken.allCases.map(\.rawValue)))
        #expect(Set(dark.keys) == Set(light.keys))
        for token in PaletteToken.allCases {
            #expect(try Self.parse(#require(light[token.rawValue])) == token.value.light, "light \(token.rawValue)")
            #expect(try Self.parse(#require(dark[token.rawValue])) == token.value.dark, "dark \(token.rawValue)")
        }
    }

    @Test("whenComparedWithBaseline_CategoryColors_ShouldMatch")
    func categories() throws {
        let colors = try #require(tokens["categoryColors"] as? [String: String])
        #expect(Set(colors.keys) == Set(CategoryColor.allCases.map(\.rawValue)))
        for category in CategoryColor.allCases {
            #expect(try Self.parse(#require(colors[category.rawValue])) == category.value, "\(category.rawValue)")
        }
    }

    @Test("whenCategoryColorsListed_CategoryColor_ShouldNeverReuseAMeaningColor")
    func categoriesAvoidMeaningColors() {
        let meaning: [PaletteToken] = [.tint, .income, .invest, .pending, .danger]
        let reserved = Set(meaning.flatMap { [$0.value.light, $0.value.dark] })
        for category in CategoryColor.allCases {
            #expect(!reserved.contains(category.value), "\(category.rawValue) reuses a meaning color")
        }
    }

    @Test("whenComparedWithBaseline_MetricsAndTypeScale_ShouldMatch")
    func metrics() throws {
        let radius = try #require(tokens["radius"] as? [String: Double])
        #expect(radius == ["card": Metrics.cardRadius, "row": Metrics.rowRadius, "field": Metrics.fieldRadius])
        #expect(tokens["gutter"] as? Double == Metrics.gutter)
        #expect(tokens["minTouchTarget"] as? Double == Metrics.minTouchTarget)

        let scale = try #require(tokens["typeScale"] as? [String: [Double]])
        #expect(Set(scale.keys) == Set(TypeScale.allCases.map(\.rawValue)))
        for entry in TypeScale.allCases {
            #expect(scale[entry.rawValue] == [entry.size, Double(entry.weight)], "\(entry.rawValue)")
        }
    }

    @Test("whenBaselineNamesFonts_iOS_ShouldUseSystemFontAndSymbols")
    func systemFontAndSymbols() throws {
        let fonts = try #require(tokens["fonts"] as? [String: [String: String]])
        let icons = try #require(tokens["icons"] as? [String: [String: String]])
        // The app bundles no font files: SF Pro and SF Symbols ship with iOS.
        #expect(fonts["ios"]?["family"] == "SF Pro")
        #expect(icons["ios"]?["family"] == "SF Symbols")
    }

    /// Parses `#RRGGBB` and `rgba(r, g, b, a)` as written in the baseline.
    static func parse(_ css: String) throws -> RGBA {
        if css.hasPrefix("#") {
            return RGBA(try #require(UInt32(css.dropFirst(), radix: 16)))
        }
        let inner = try #require(css.split(separator: "(").last?.split(separator: ")").first)
        let parts = inner.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        try #require(parts.count == 4, "Unexpected color \(css)")
        return RGBA(
            red: try #require(UInt8(parts[0])), green: try #require(UInt8(parts[1])),
            blue: try #require(UInt8(parts[2])), alpha: try #require(Double(parts[3])))
    }
}
