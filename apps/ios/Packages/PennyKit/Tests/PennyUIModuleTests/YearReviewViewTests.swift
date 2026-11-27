import CoreGraphics
import Foundation
import PennyData
import PennyDesign
import PennyDomain
import SwiftUI
import Testing

@testable import PennyUI

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

/// The year in review in the app (MAZ-292, phase 2): the January banner beside the monthly recap's,
/// the pages' words, and the share image, which must never carry an entry's title or note, a
/// receipt, or a trip's or household's name, in either version.
@Suite("Year in review in the app")
@MainActor
struct YearReviewViewTests {
    static func date(_ text: String) throws -> CalendarDate { try #require(CalendarDate(text)) }

    /// A year whose every name is a secret: titles, notes, the trip's and the households' names.
    static func report() throws -> LedgerReport {
        let trip = Trip(
            id: "t1", name: "Secret Lisbon getaway", startDate: try date("2026-11-12"), endDate: try date("2026-11-19"))
        func entry(_ id: String, _ cents: Int64, _ day: String, category: String, trip: String? = nil) throws
            -> LedgerEntry
        {
            LedgerEntry(
                id: id, title: "Secret title \(id)", kind: .expense, total: cents * 2, share: cents,
                participants: 2, categoryId: category, accountId: nil, tripId: trip, date: try date(day),
                note: "Secret note \(id)",
                receipt: ReceiptReference(
                    id: "receipt-\(id)", name: "Secret receipt.jpg", uri: "receipt:\(id)", mime: "image/jpeg"))
        }
        let ledger = Ledger(
            trips: [trip],
            transactions: [
                try entry("rent", 145_000, "2026-03-01", category: "home"),
                try entry("food", 8_000, "2026-11-14", category: "food", trip: "t1"),
                try entry("bus", 2_000, "2026-12-02", category: "transport"),
            ])
        func shared(_ id: String, _ day: String, payer: SharedPayer?, email: String?) throws -> SharedExpenseShare {
            SharedExpenseShare(
                id: id, householdId: "h1", currency: .cad, title: "Secret shared \(id)", date: try date(day),
                total: 10_000, share: 5_000,
                category: .init(name: "Groceries", icon: "basket-outline", color: "#0FA3A3"),
                note: "Secret shared note", householdName: "Secret Household", payer: payer, payerEmail: email)
        }
        return LedgerReport(
            ledger: ledger,
            shared: [
                try shared("s1", "2026-05-02", payer: .you, email: nil),
                try shared("s2", "2026-05-09", payer: .member(name: "Jo Secretname"), email: "jo@example.test"),
                try shared("s3", "2026-06-09", payer: .member(name: "Jo Secretname"), email: "Jo@example.test"),
                try shared("s4", "2026-07-09", payer: .member(name: "mira@example.test"), email: "mira@example.test"),
                try shared("s5", "2026-08-09", payer: .member(name: "Former member"), email: "gone@example.test"),
            ])
    }

    static let households = [YearReview.Household(id: "h1", memberCount: 3)]
    static let secrets = [
        "Secret title", "Secret note", "Secret receipt", "Secret Lisbon", "Secret shared", "Secret Household",
        "Secretname", "@", "example.test",
    ]

    @Test("whenAmountsAreHidden_ShareImage_ShouldHoldNoAmountAndNoName")
    func hidden() throws {
        let review = try Self.report().yearReview(2026, today: try Self.date("2027-01-05"), households: Self.households)
        let content = YearShareContent(
            review, currency: "CAD", showsAmounts: false, locale: Locale(identifier: "en_CA"))
        let text = content.lines.joined(separator: "\n")
        #expect(!content.showsAmounts)
        #expect(!text.contains("$"), "no amount: \(text)")
        #expect(!text.contains("Jo"), "no name")
        #expect(!text.contains("Former member"))
        #expect(content.title == "My 2026")
        #expect(content.lines.contains("Where my money went"))
        #expect(content.categories.map(\.rank) == [1, 2, 3])
        #expect(content.categories.allSatisfy { $0.amount == nil })
        #expect(content.tiles.map(\.key) == ["month", "trips", "shared", "quiet"])
        #expect(content.lines.contains("I paid for 20% of our shared expenses"))
        #expect(content.lines.contains { $0.hasSuffix("days without spending") })
        #expect(content.lines.last == "Made with Penny")
        for secret in Self.secrets { #expect(!text.contains(secret), "\(secret) is on the image") }
    }

    @Test("whenAmountsAreShown_ShareImage_ShouldAddAmountsAndFirstNamesButNeverEntryTripOrHouseholdText")
    func shown() throws {
        let review = try Self.report().yearReview(2026, today: try Self.date("2027-01-05"), households: Self.households)
        let content = YearShareContent(review, currency: "CAD", showsAmounts: true, locale: Locale(identifier: "en_CA"))
        let text = content.lines.joined(separator: "\n")
        #expect(content.total == MoneyFormat.whole(review.spent, currency: "CAD", locale: Locale(identifier: "en_CA")))
        #expect(content.subtitle == " spent")
        #expect(content.categories.allSatisfy { $0.amount?.contains("$") == true })
        #expect(content.tiles.first?.subtitle.hasPrefix("busiest month · $") == true)
        // Jo paid twice (her email in two cases is one person), then you, a deleted account and
        // Mira, who has no display name ("A member", never her email).
        let shared = try #require(content.tiles.first { $0.key == "shared" })
        #expect(shared.title == "Jo paid 2 · I paid 1")
        #expect(shared.subtitle == "of our shared expenses · Former member 1")
        for secret in Self.secrets { #expect(!text.contains(secret), "\(secret) is on the image") }
    }

    @Test("whenTheYearHasNoTripsOrSharedExpenses_ShareImage_ShouldLeaveThoseLinesOut")
    func emptyLines() throws {
        let ledger = Ledger(transactions: [
            LedgerEntry(
                id: "a", title: "A", kind: .expense, total: 500, share: 500, categoryId: "food",
                date: try Self.date("2026-04-02"))
        ])
        let review = LedgerReport(ledger: ledger).yearReview(2026, today: try Self.date("2027-01-05"), households: [])
        let content = YearShareContent(review, currency: "CAD", showsAmounts: false)
        // The busiest month alone takes the whole row.
        #expect(content.tiles.map(\.key) == ["month", "quiet"])
        #expect(content.tiles.first?.wide == true)
        let empty = LedgerReport(ledger: Ledger()).yearReview(2026, today: try Self.date("2027-01-05"), households: [])
        let nothing = YearShareContent(empty, currency: "CAD", showsAmounts: true)
        #expect(nothing.categories.isEmpty)
        #expect(nothing.tiles.isEmpty)
    }

    @Test("whenAPayerHasNoDisplayName_ShareName_ShouldNeverBeTheirEmail")
    func shareNames() throws {
        let review = try Self.report().yearReview(2026, today: try Self.date("2027-01-05"), households: Self.households)
        let names = review.shared.payers.map(YearShareContent.shareName)
        #expect(names == ["Jo", "A member", "Former member", "A member"])
        #expect(
            review.shared.payers.map(\.key) == ["jo@example.test", "you", "gone@example.test", "mira@example.test"])
    }

    /// The image is drawn by `ImageRenderer`, as the sheet does: both versions render at the
    /// shared size, differ from each other, and stay light whatever the app's appearance. With
    /// `PENNY_YEAR_SHARE_RENDER_DIR` set, the images are saved there for review.
    @Test("whenRenderedInBothVersions_ShareImage_ShouldBeLightAndTheSharedSize")
    func render() throws {
        let review = try Self.report().yearReview(2026, today: try Self.date("2027-01-05"), households: Self.households)
        let directory = ProcessInfo.processInfo.environment["PENNY_YEAR_SHARE_RENDER_DIR"].map { URL(filePath: $0) }
        if let directory { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        var pixels: [[UInt8]] = []
        for amounts in [false, true] {
            let content = YearShareContent(review, currency: "CAD", showsAmounts: amounts)
            let image = try #require(YearShareImage.render(content, scale: 2))
            #expect(image.width == 472)
            #expect(image.height == 840)
            let bytes = try Self.rgba(image)
            pixels.append(bytes)
            // The paper near the bottom-right corner, inside the rounded edge: light, not the dark
            // appearance's background.
            let (red, green, blue) = Self.pixel(bytes, width: image.width, x: image.width - 12, y: image.height - 60)
            #expect(red > 230 && green > 225 && blue > 215, "paper \(red),\(green),\(blue)")
            if let directory {
                try Self.save(image, to: directory.appending(path: "year-share-\(amounts ? "amounts" : "hidden").png"))
            }
        }
        #expect(pixels[0] != pixels[1], "the two versions differ")
        #expect(YearShareImage.title(2026) == "My 2026 in Penny")
    }

    static func rgba(_ image: CGImage) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let context = try #require(
            CGContext(
                data: &bytes, width: image.width, height: image.height, bitsPerComponent: 8,
                bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return bytes
    }

    /// The pixel at (`x`, `y`) from the top.
    static func pixel(_ bytes: [UInt8], width: Int, x: Int, y: Int) -> (Int, Int, Int) {
        let height = bytes.count / 4 / width
        let index = ((height - 1 - y) * width + x) * 4
        return (Int(bytes[index]), Int(bytes[index + 1]), Int(bytes[index + 2]))
    }

    static func save(_ image: CGImage, to url: URL) throws {
        #if canImport(UIKit)
            try UIImage(cgImage: image).pngData()?.write(to: url)
        #elseif canImport(AppKit)
            try NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: url)
        #endif
    }

    // MARK: Banner

    static func defaults() throws -> UserDefaults {
        let name = "penny.tests.year.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test("whenJanuaryOverlapsDecembersRecap_YearBanner_ShouldShowInsteadUntilDismissed")
    func banner() throws {
        let defaults = try Self.defaults()
        let recap = MonthlyRecap(defaults: defaults, center: nil)
        let report = LedgerReport(
            ledger: Ledger(transactions: [
                LedgerEntry(
                    id: "a", title: "A", kind: .expense, total: 500, share: 500, categoryId: "food",
                    date: try Self.date("2026-12-12"))
            ]))
        let december = try #require(MonthKey("2026-12"))
        #expect(recap.banner(today: try Self.date("2027-01-03"), report: report) == .year(2026), "the two never stack")
        #expect(recap.banner(today: try Self.date("2027-01-20"), report: report) == .year(2026))
        #expect(recap.banner(today: try Self.date("2027-02-01"), report: report) == nil)
        #expect(recap.banner(today: try Self.date("2026-12-28"), report: report) == nil, "December has the card only")
        recap.dismiss(year: 2026)
        #expect(
            recap.banner(today: try Self.date("2027-01-03"), report: report) == .month(december),
            "December's recap in its first 7 days once the year's banner is dismissed")
        #expect(recap.banner(today: try Self.date("2027-01-20"), report: report) == nil)
        // Kept on the device.
        #expect(MonthlyRecap(defaults: defaults, center: nil).isDismissed(year: 2026))
        #expect(!MonthlyRecap(defaults: defaults, center: nil).isDismissed(year: 2025))
    }

    @Test("whenTheYearHasNothingRecorded_YearReview_ShouldOfferNoCardAndNoBanner")
    func emptyYear() throws {
        let recap = MonthlyRecap(defaults: nil, center: nil)
        // Income dated after today is expected, not recorded.
        let report = LedgerReport(
            ledger: Ledger(transactions: [
                LedgerEntry(
                    id: "pay", title: "Pay", kind: .income, total: 500, share: 500, categoryId: "salary",
                    date: try Self.date("2026-12-31"))
            ]))
        #expect(YearReviewText.offeredYear(today: try Self.date("2026-12-27"), report: report) == nil)
        #expect(YearReviewText.offeredYear(today: try Self.date("2027-01-02"), report: report) == 2026)
        #expect(recap.bannerYear(today: try Self.date("2027-01-02"), report: report) == 2026)
        #expect(recap.bannerYear(today: try Self.date("2027-01-02"), report: LedgerReport(ledger: Ledger())) == nil)
    }

    // MARK: Words

    @Test("whenTheYearHasTripsAndPayers_YearReviewText_ShouldReadAsTheCards")
    func words() throws {
        let review = try Self.report().yearReview(2026, today: try Self.date("2027-01-05"), households: Self.households)
        #expect(YearReviewText.leadTitle(review) == "Home took the biggest share of your year")
        #expect(YearReviewText.busiestTitle(review) == "Busiest month: March")
        #expect(YearReviewText.tripsTitle(review) == "1 trip, 8 days away")
        #expect(YearReviewText.tripsLede(review, name: { _ in "Lisbon" }) == "Lisbon was your trip this year.")
        #expect(YearReviewText.sharedTitle(review) == "You paid for 1 shared expense")
        #expect(
            YearReviewText.sharedLede(review, householdName: { _ in "Apartment" })
                == "Jo Secretname paid for 2, across Apartment.")
        #expect(YearReviewText.sharedFoot(review).counted == "Counted by who paid, out of 5 shared expenses.")
        #expect(YearReviewText.list(["A", "B", "C"]) == "A, B and C")
        #expect(YearReviewText.weekdayName(6) == "Saturday")
        #expect(YearReviewText.weekdayName(7) == "Sunday")
        let facts = YearReviewText.facts(review)
        #expect(facts.map(\.key) == ["quiet", "run", "recorded", "weekday"])
        #expect(YearReviewText.eyebrow(2026) == "2026 in review")
        #expect(YearReviewText.bannerTitle(2026) == "Your 2026 in review is ready")
    }
}
