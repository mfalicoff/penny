import Foundation
import PennyAccessibility
import XCTest

private typealias SharedCurrencies = AccessibilityID.SharedCurrencies
private typealias Trips = AccessibilityID.Trips

/// The MAZ-270 cards of shared trips in several currencies (MAZ-151, phase 2), captured with the
/// other cards (`CardCaptureTests`, Cards plan). They need a stack with exchange rates
/// (`PENNY_STACK_RATES=1 ios.sh ui-test cards`: `penny-env --rates`, synthetic per-euro quotes for
/// the last 60 days). Before each capture the trip is written through the real API as the
/// members' devices would (`seedTripCurrencies`): Porto, a shared trip in euros for Alex (CAD),
/// Béa (CAD) and Cam (whose ledger is in US dollars), with expenses paid in euros, US dollars and
/// Canadian dollars, each converted at its date's rate.
extension CardCaptureTests {
    static let needsRates =
        "Needs exchange rates: run with PENNY_STACK_RATES=1 (penny-env --rates), so the trip's expenses convert"

    @MainActor
    func test_whenSeeded_IphoneTripCurrencies_ShouldBeCaptured() async throws {
        guard try await stack().servesRates() else {
            return try blocked("iphone-trip-currencies", note: Self.needsRates)
        }
        try await card(
            "iphone-trip-currencies",
            note: "Porto stands in for Lisbon (the seed's Lisbon trip is in CAD); rates are the stack's synthetic ones"
        ) { card in
            let trip = try await card.seedTripCurrencies()
            try card.openTrip(trip)
            try card.penny.wait(for: SharedCurrencies.chip, timeout: 30)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneTripBalancesCurrency_ShouldBeCaptured() async throws {
        guard try await stack().servesRates() else {
            return try blocked("iphone-trip-balances-currency", note: Self.needsRates)
        }
        try await card(
            "iphone-trip-balances-currency",
            note: "October's balances: Penny settles shared trips month by month"
        ) { card in
            let trip = try await card.seedTripCurrencies()
            try card.openTrip(trip)
            try card.penny.selectSegment("Balances", in: AccessibilityID.Households.section)
            try card.penny.wait(for: SharedCurrencies.balancesTitle, timeout: 30)
        }
    }

    @MainActor
    func test_whenSeeded_IphoneTripFormCurrency_ShouldBeCaptured() async throws {
        try await card("iphone-trip-form-currency") { card in
            try card.penny.openTrips()
            try card.penny.tap(Trips.new, opening: Trips.Screen.form)
            try card.penny.type("Lisbon\n", into: Trips.formName)
            _ = card.app.keyboards.firstMatch.waitForNonExistence(timeout: 5)
            try card.penny.tap(SharedCurrencies.tripCurrency)
            try card.penny.wait(for: AccessibilityID.Currencies.Screen.picker)
            let search = card.app.searchFields.firstMatch
            guard search.waitForExistence(timeout: Penny.timeout) else {
                throw UIExpectationFailed(description: "The currency picker has no search field")
            }
            search.tap()
            search.typeText("Euro")
            try card.penny.tap(AccessibilityID.Currencies.option("EUR"))
            try card.penny.waitForAbsence(of: AccessibilityID.Currencies.Screen.picker)
            try card.penny.turnOn(Trips.formShare)
        }
    }

    @MainActor
    func test_whenSeeded_IpadTripCurrencies_ShouldBeCaptured() async throws {
        guard try await stack().servesRates() else { return try blocked("ipad-trip-currencies", note: Self.needsRates) }
        try await card(
            "ipad-trip-currencies",
            note: "Porto stands in for Lisbon (the seed's Lisbon trip is in CAD); October's balances"
        ) { card in
            let trip = try await card.seedTripCurrencies()
            try card.openTrip(trip)
            try card.penny.wait(for: SharedCurrencies.balancesTitle, timeout: 30)
        }
    }
}

@MainActor
extension CardContext {
    /// Writes Porto (a shared trip in euros) once for the card's seed, as Alex, Béa and Cam's
    /// devices would, and returns its id. Cam's empty ledger moves to US dollars first, so his
    /// balance also shows in his own currency.
    func seedTripCurrencies() async throws -> String {
        let seed = try seeded()
        let alex = try seed.user("alex").token
        let bea = try seed.user("bea").token
        let cam = try seed.user("cam").token
        if let existing = try await stack.households(token: alex).first(where: { $0["name"] as? String == "Porto" }),
            let id = existing["id"] as? String
        {
            return id
        }
        try await stack.updateLedger(token: cam) { ledger in ledger["currency"] = "USD" }
        let created = try await stack.api(
            "POST", "/api/households/trips",
            body: [
                "name": "Porto", "currency": "EUR", "startDate": "2026-10-12", "endDate": "2026-10-18",
                "timezoneOffsetMinutes": 0,
            ], token: alex)
        guard let trip = (created["household"] as? [String: Any])?["id"] as? String else {
            throw UIExpectationFailed(description: "POST /api/households/trips returned no household")
        }
        let code = try await stack.invite(token: alex, household: trip)
        try await stack.join(token: bea, code: code)
        try await stack.join(token: cam, code: code)
        let ids = try await memberIDs(trip: trip, token: alex)
        func expense(
            _ token: String, payer: String, title: String, date: String, category: [String: String], paid: Int,
            currency: String
        ) async throws {
            var body: [String: Any] = [
                "title": title, "date": date, "payerUserId": payer, "splitMode": "equal", "category": category,
                "note": "", "timezoneOffsetMinutes": 0,
            ]
            if currency == "EUR" {
                body["totalCents"] = paid
            } else {
                let rates = try await stack.api("GET", "/api/rates?base=EUR&date=\(date)", token: token)
                guard let rate = (rates["rates"] as? [String: Any])?[currency] as? String,
                    let rateDate = rates["rateDate"] as? String
                else { throw UIExpectationFailed(description: "No EUR rate for \(currency) on \(date)") }
                body["totalCents"] = Self.convert(paid, rate: rate)
                body["originalAmount"] = paid
                body["originalCurrency"] = currency
                body["rate"] = rate
                body["rateStatus"] = (rates["provisional"] as? Bool) == true ? "provisional" : "published"
                body["rateDate"] = rateDate
            }
            _ = try await stack.api("POST", "/api/households/\(trip)/expenses", body: body, token: token)
        }
        let travel = ["name": "Travel", "icon": "airplane-outline", "color": "#5B7DB1"]
        try await expense(
            cam, payer: ids["cam"] ?? "", title: "Flights", date: "2026-10-02", category: travel, paid: 60_000,
            currency: "USD")
        try await expense(
            alex, payer: ids["alex"] ?? "", title: "Apartment", date: "2026-10-08",
            category: ["name": "Housing", "icon": "home-outline", "color": "#3B82F6"], paid: 25_600, currency: "EUR")
        try await expense(
            bea, payer: ids["bea"] ?? "", title: "Travel insurance", date: "2026-10-05",
            category: ["name": "Insurance", "icon": "heart-outline", "color": "#0E7490"], paid: 2_230,
            currency: "CAD")
        try await expense(
            bea, payer: ids["bea"] ?? "", title: "Fado tickets", date: "2026-10-14",
            category: ["name": "Fun", "icon": "musical-notes-outline", "color": "#6B8E23"], paid: 12_000,
            currency: "EUR")
        return trip
    }

    /// The members' ids by seed alias, matched on their seeded emails.
    private func memberIDs(trip: String, token: String) async throws -> [String: String] {
        let seed = try seeded()
        let detail = try await stack.api("GET", "/api/households/\(trip)", token: token)
        let members = detail["members"] as? [[String: Any]] ?? []
        var ids: [String: String] = [:]
        for alias in ["alex", "bea", "cam"] {
            let email = try seed.user(alias).email.lowercased()
            ids[alias] = members.first { ($0["email"] as? String)?.lowercased() == email }?["userId"] as? String
        }
        return ids
    }

    /// `minor` units of a two-decimal currency in euro cents at `rate` (euros per unit), rounded
    /// once, half up, as the shared rules do.
    static func convert(_ minor: Int, rate: String) -> Int {
        let value = NSDecimalNumber(value: minor).multiplying(by: NSDecimalNumber(string: rate))
        let rounding = NSDecimalNumberHandler(
            roundingMode: .plain, scale: 0, raiseOnExactness: false, raiseOnOverflow: false,
            raiseOnUnderflow: false, raiseOnDivideByZero: false)
        return value.rounding(accordingToBehavior: rounding).intValue
    }

    /// Opens the shared trip from Trips, featured or listed.
    func openTrip(_ id: String) throws {
        try penny.openTrips()
        let listed = penny.element(AccessibilityID.Row.trip(id))
        let featured = penny.element(Trips.featured)
        let deadline = Date().addingTimeInterval(30)
        while !listed.exists && !featured.exists {
            guard Date() < deadline else { throw UIExpectationFailed(description: "Porto is not listed") }
            penny.pullHouseholdToRefresh(AccessibilityID.Screen.trips)
            _ = listed.waitForExistence(timeout: 3)
        }
        let row = listed.exists ? listed : featured
        for _ in 0..<3 {
            row.tap()
            if penny.element(Trips.Screen.sharedTrip).waitForExistence(timeout: 8) { return }
        }
        try penny.wait(for: Trips.Screen.sharedTrip)
    }
}
