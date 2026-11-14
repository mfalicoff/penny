import Foundation
import PennyDesign
import Testing

/// The category form's palette and icons, and how a stored category color is drawn (MAZ-74).
@Suite("Category palette and icons")
struct CategoryPaletteTests {
    @Test("whenAPaletteColorIsStored_Hex_ShouldMatchTheBaselineValue")
    func hexMatchesBaseline() throws {
        let tokens = try #require(try Repository.json("contracts/design-baseline.json")["tokens"] as? [String: Any])
        let colors = try #require(tokens["categoryColors"] as? [String: String])
        for color in CategoryColor.allCases {
            #expect(CategoryStyle.hex(color) == colors[color.rawValue]?.uppercased(), "\(color.rawValue)")
        }
    }

    @Test("whenTheFormOffersColors_PickerColors_ShouldBeTheWholeCategoryPaletteAndStoreValidHex")
    func pickerColors() {
        #expect(Set(CategoryStyle.pickerColors) == Set(CategoryColor.allCases))
        #expect(CategoryStyle.pickerColors.count == CategoryColor.allCases.count)
        for color in CategoryStyle.pickerColors {
            let hex = CategoryStyle.hex(color)
            #expect(hex.count == 7 && hex.first == "#" && UInt32(hex.dropFirst(), radix: 16) != nil, "\(hex)")
            #expect(!CategoryStyle.colorName(color).isEmpty)
        }
    }

    @Test("whenACategoryIsDrawn_ColorForStoredHex_ShouldPreferTheStoredRedesignColor")
    func storedColor() {
        #expect(CategoryStyle.color(forCategoryID: "c-1", hex: "#E0529C") == .food)
        #expect(CategoryStyle.color(forCategoryID: "c-1", hex: "#e0529c") == .food, "either case")
        #expect(CategoryStyle.color(forCategoryID: "home", hex: "#0FA3A3") == .groceries, "a restyled default")
    }

    @Test("whenALedgerPaletteColorIsStored_ColorForStoredHex_ShouldUseTheDefaultOrTheMappedColor")
    func ledgerPaletteColor() {
        #expect(CategoryStyle.color(forCategoryID: "home", hex: "#C6953A") == .home, "default ids keep theirs")
        #expect(CategoryStyle.color(forCategoryID: "fun", hex: "#9D83BA") == .entertainment)
        #expect(CategoryStyle.color(forCategoryID: "c-2", hex: "#E47850") == .food)
        #expect(CategoryStyle.color(forCategoryID: "c-3", hex: "#678DB1") == .transport)
        #expect(CategoryStyle.color(forCategoryID: "c-4", hex: "#123456") == .other, "unknown colors are gray")
    }

    @Test("whenTheFormOffersIcons_PickerIcons_ShouldEachHaveTheirOwnSymbolAndName")
    func pickerIcons() {
        #expect(Set(CategoryStyle.pickerIcons).count == CategoryStyle.pickerIcons.count, "no duplicates")
        for icon in CategoryStyle.pickerIcons {
            let symbol = CategoryStyle.symbol(forIonicon: icon)
            #expect(symbol != "tag" || icon == "pricetag-outline", "\(icon) has no SF Symbol")
            #expect(!CategoryStyle.iconName(icon).isEmpty)
            #expect(icon.utf16.count <= 80, "fits the ledger's icon limit")
        }
        let symbols = CategoryStyle.pickerIcons.map(CategoryStyle.symbol(forIonicon:))
        #expect(Set(symbols).count == symbols.count, "every icon looks different")
        #expect(CategoryStyle.sameIcon("home", "home-outline"))
        #expect(!CategoryStyle.sameIcon("home-outline", "heart-outline"))
        #expect(CategoryStyle.iconName("bag-handle-outline") == "Bag handle")
    }
}
